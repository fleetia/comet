import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from verify_linux_bundle import elf_x64, verify_package, verify_tree


ELF = b'\x7fELF\x02\x01' + bytes(12) + b'\x3e\x00'


class LinuxBundleTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        for name in ['comet', 'llama-server', 'comet-nlp']:
            self.write('usr/bin/' + name, ELF, executable=True)
        for directory, names in [
            ('runtime', ['libllama.so', 'libllama-server-impl.so', 'libggml-cpu-x64.so']),
            ('nlp-runtime', ['libkiwi.so', 'libonnxruntime.so', 'libonnxruntime_providers_shared.so']),
        ]:
            for name in names:
                self.write(f'usr/lib/comet/{directory}/{name}', ELF)
            self.write(f'usr/lib/comet/{directory}/release.json', b'{}')
        for directory, names in [('runtime', ['llama.cpp-LICENSE.txt']),
                                 ('nlp-runtime', ['Kiwi-LICENSE', 'Kiwi-NOTICE', 'onnxruntime-LICENSE'])]:
            for name in names:
                self.write(f'usr/lib/comet/{directory}/{name}', b'license')
        self.write('usr/share/applications/comet.desktop', b'[Desktop Entry]')

    def write(self, name: str, content: bytes, executable: bool = False) -> Path:
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
        if executable:
            path.chmod(0o755)
        return path

    @staticmethod
    def command(args, **kwargs):
        if args[0] == 'ldd':
            return 'libc.so.6 => /lib/x86_64-linux-gnu/libc.so.6'
        if '--version' in args:
            return 'version: b10970\n'
        return json.dumps(dict(version=1, ready=True, kiwi=False, semantic=False, errors=[])) + '\n'

    def test_complete_tree_loads_all_native_libraries_and_model_free_sidecars(self) -> None:
        with patch('verify_linux_bundle.command', side_effect=self.command) as run:
            verify_tree(self.root, 'comet')
        self.assertEqual(sum(call.args[0][0] == 'ldd' for call in run.call_args_list), 9)
        self.assertEqual(run.call_args_list[-1].kwargs['input'], '')
        self.assertNotIn(str(self.root / 'usr/bin/comet'), [call.args[0][0] for call in run.call_args_list])

    def test_missing_runtime_or_license_fails_before_launch(self) -> None:
        for relative in ['runtime/libllama.so', 'nlp-runtime/libkiwi.so', 'nlp-runtime/onnxruntime-LICENSE']:
            with self.subTest(relative=relative):
                path = self.root / 'usr/lib/comet' / relative
                contents = path.read_bytes()
                path.unlink()
                with patch('verify_linux_bundle.command') as run, self.assertRaises(ValueError):
                    verify_tree(self.root, 'comet')
                run.assert_not_called()
                path.write_bytes(contents)

    @unittest.skipIf(os.name == 'nt', 'Windows symlink creation can require elevated privileges')
    def test_aliases_must_resolve_inside_extracted_bundle(self) -> None:
        alias = self.root / 'usr/lib/comet/nlp-runtime/libkiwi.so.0'
        for target in ['/etc/passwd', 'missing.so']:
            with self.subTest(target=target):
                alias.symlink_to(target)
                with self.assertRaisesRegex(ValueError, 'Invalid bundled symlink'):
                    verify_tree(self.root, 'comet')
                alias.unlink()
        alias.symlink_to('libkiwi.so')
        with patch('verify_linux_bundle.command', side_effect=self.command):
            verify_tree(self.root, 'comet')

    def test_wrong_elf_architecture_and_non_executable_fail(self) -> None:
        path = self.root / 'usr/bin/comet'
        for contents in [b'not-ELF', ELF[:-2] + b'\xb7\x00']:
            path.write_bytes(contents)
            with self.assertRaisesRegex(ValueError, 'x86_64 ELF'):
                elf_x64(path)
        path.write_bytes(ELF)
        path.chmod(0o644)
        with self.assertRaisesRegex(ValueError, 'not executable'):
            verify_tree(self.root, 'comet')

    def test_unresolved_dependencies_fail(self) -> None:
        with patch('verify_linux_bundle.command', return_value='libmissing.so => not found'), self.assertRaisesRegex(ValueError, 'Unresolved'):
            verify_tree(self.root, 'comet')

    def test_unhealthy_nlp_handshake_fails(self) -> None:
        def command(args, **kwargs):
            return json.dumps(dict(ready=True, kiwi=False, semantic=False, errors=['load failed'])) if '--runtime' in args else self.command(args, **kwargs)
        with patch('verify_linux_bundle.command', side_effect=command), self.assertRaisesRegex(ValueError, 'NLP startup'):
            verify_tree(self.root, 'comet')

    def test_deb_metadata_is_checked_before_extraction(self) -> None:
        for name, outputs in [('comet_0.8.0_arm64.deb', []), ('comet_0.7.0_amd64.deb', []),
                              ('comet_0.8.0_amd64.deb', ['0.7.0']), ('comet_0.8.0_amd64.deb', ['0.8.0', 'arm64'])]:
            with self.subTest(name=name, outputs=outputs), patch('verify_linux_bundle.command', side_effect=outputs), patch('verify_linux_bundle.verify_tree') as tree:
                with self.assertRaises(ValueError):
                    verify_package(Path(name), '0.8.0', 'comet')
                tree.assert_not_called()

    def test_matching_package_is_extracted_without_installing(self) -> None:
        with patch('verify_linux_bundle.command', side_effect=['0.8.0', 'amd64', '']) as run, patch('verify_linux_bundle.verify_tree') as tree:
            verify_package(Path('comet_0.8.0_amd64.deb'), '0.8.0', 'comet')
        self.assertEqual(run.call_args_list[-1].args[0][:2], ['dpkg-deb', '--extract'])
        tree.assert_called_once()


if __name__ == '__main__':
    unittest.main()
