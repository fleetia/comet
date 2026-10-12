import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";

const require = createRequire(import.meta.url);
const sharp = require(process.env.COMET_SHARP_MODULE || "sharp");
const packUrl = new URL(
  "../examples/character-packs/byulkkori.comet-character.json",
  import.meta.url,
);
const outputUrl = new URL("../character-packs/byulkkori-motions/", import.meta.url);
const pack = JSON.parse(await readFile(packUrl, "utf8"));
const source = Buffer.from(
  pack.sprites.find((sprite) => sprite.expression === "평온").data,
  "base64",
).toString("utf8");
const paths = Object.fromEntries(
  [...source.matchAll(/<path id="([^"]+)"[^>]*fill="([^"]+)"[^>]*d="([^"]+)"/g)].map((match) => [
    match[1],
    { color: match[2], path: match[3] },
  ]),
);

function points(path) {
  const commands = [...path.matchAll(/([MHVZ])([\d ]*)/g)];
  let x = 0;
  let y = 0;
  const result = [];
  for (const [, command, value] of commands) {
    const values = value.trim().split(/\s+/).map(Number);
    if (command === "M") [x, y] = values;
    if (command === "H") x = values[0];
    if (command === "V") y = values[0];
    if (command !== "Z") result.push([x, y]);
  }
  return result;
}

function shape(id, transform) {
  const item = paths[id];
  const vertices = points(item.path).map(([x, y]) => transform(x, y).map(Math.round));
  return `<path fill="${item.color}" d="${vertices.map(([x, y], index) => `${index ? "L" : "M"}${x} ${y}`).join("")}Z"/>`;
}

function rect(x, y, width, height, fill) {
  return `<rect x="${Math.round(x)}" y="${Math.round(y)}" width="${width}" height="${height}" fill="${fill}"/>`;
}

const clips = [
  ["idle", "꼬리 인사와 눈 깜빡임"],
  ["poke-head", "머리를 콕"],
  ["poke-body", "몸을 콕"],
  ["stroke-head", "머리 쓰다듬기"],
  ["stroke-body", "몸 쓰다듬기"],
  ["cheek-start", "볼이 당겨짐"],
  ["cheek-hold", "볼 잡고 있기"],
  ["cheek-end", "볼 놓기"],
  ["pickup-start", "집어 들기"],
  ["hang-moving", "움직이며 매달리기"],
  ["hang-still", "가만히 매달리기"],
  ["landing", "내려놓고 자세 잡기"],
  ["snack", "별 과자 먹기"],
];
const lifeClips = [
  ["sleep", "조용히 잠들기"],
  ["wake", "눈뜨고 일어나기"],
  ["focus", "책을 보며 집중하기"],
  ["rest", "앉아서 쉬기"],
  ["music", "꼬리와 손으로 음악 듣기"],
  ["drink", "따뜻한 음료 받기"],
  ["gift", "작은 선물 받아 보기"],
  ["idle-yawn", "졸린 하품"],
  ["idle-stretch", "기지개 켜기"],
];
const wanderClips = [
  ["walk", "가벼운 산책"],
  ["fast-walk", "빠른 걸음"],
  ["crawl", "낮게 기기"],
  ["climb", "가장자리 잡고 오르기"],
  ["short-fall", "짧게 떨어져 자세 잡기"],
  ["peek", "가장자리에서 빼꼼"],
];
const pulse = [0, 1, 2, 2, 1, 0, -1, 0];
const rise = [0, 1, 2, 3, 3, 3, 3, 3];
const settle = [3, 3, 2, 1, 0, -1, 0, 0];

function frame(clip, index) {
  const wave = pulse[index];
  let lean = 0;
  let squash = 0;
  let lift = 0;
  let cheek = 0;
  let eyes = "open";
  let dangling = false;
  let effects = "";
  let bodyScale = 1;
  let arms = "";
  let feet = "";
  let mouth = false;
  switch (clip) {
    case "idle":
      eyes = index === 3 ? "blink" : "open";
      break;
    case "poke-head":
      squash = pulse[index];
      eyes = index < 4 ? "wide" : "open";
      break;
    case "poke-body":
      lean = -wave;
      eyes = index < 5 ? "blink" : "open";
      break;
    case "stroke-head":
      squash = Math.max(0, wave);
      eyes = "closed";
      break;
    case "stroke-body":
      lean = wave;
      eyes = "closed";
      break;
    case "cheek-start":
      cheek = rise[index];
      eyes = "blink";
      break;
    case "cheek-hold":
      cheek = 3 + (index === 2 || index === 6 ? 1 : 0);
      eyes = "blink";
      break;
    case "cheek-end":
      cheek = Math.max(0, settle[index]);
      eyes = index < 4 ? "blink" : "open";
      break;
    case "pickup-start":
      lift = rise[index];
      dangling = index > 2;
      eyes = "wide";
      break;
    case "hang-moving":
      lift = 3;
      lean = wave + 1;
      dangling = true;
      eyes = "wide";
      break;
    case "hang-still":
      lift = 3;
      dangling = true;
      eyes = index === 3 ? "blink" : "open";
      break;
    case "landing":
      squash = Math.max(0, settle[index]);
      eyes = index < 4 ? "closed" : "open";
      break;
    case "snack":
      eyes = index < 6 ? "closed" : "open";
      squash = Math.max(0, wave);
      break;
    case "sleep":
      bodyScale = 0.55 + Math.max(0, wave) * 0.015;
      eyes = "closed";
      break;
    case "wake":
      bodyScale = 0.55 + Math.min(index, 6) * 0.075;
      eyes = index < 5 ? "closed" : "open";
      lift = index === 6 ? 1 : 0;
      break;
    case "focus":
      eyes = index === 4 ? "blink" : "open";
      squash = Math.max(0, wave) * 0.25;
      arms = "book";
      break;
    case "rest":
      bodyScale = 0.85;
      eyes = "closed";
      arms = "rest";
      break;
    case "music":
      lean = wave * 1.5;
      lift = index === 2 || index === 6 ? 1 : 0;
      eyes = "closed";
      arms = "dance";
      break;
    case "drink":
      eyes = index > 2 && index < 6 ? "closed" : "open";
      lean = index > 3 ? -1 : 0;
      arms = "cup";
      break;
    case "gift":
      eyes = index < 5 ? "wide" : "closed";
      arms = "gift";
      break;
    case "idle-yawn":
      eyes = "closed";
      mouth = index > 1 && index < 6;
      squash = Math.max(0, wave);
      break;
    case "idle-stretch":
      eyes = "closed";
      lift = Math.max(0, wave);
      arms = "stretch";
      break;
    case "walk":
    case "fast-walk":
      lean = clip === "fast-walk" ? 3 + wave : wave;
      lift = index % 4 === 1 ? 1 : 0;
      feet = "walk";
      arms = "walk";
      break;
    case "crawl":
      bodyScale = 0.62;
      lean = wave;
      feet = "crawl";
      break;
    case "climb":
      lean = 3 + wave;
      lift = index % 4 < 2 ? 1 : 3;
      arms = "climb";
      feet = "walk";
      break;
    case "short-fall":
      lift = Math.max(0, settle[index]);
      dangling = index < 3;
      squash = index > 2 ? Math.max(0, wave) : 0;
      eyes = index < 3 ? "wide" : "closed";
      break;
    case "peek":
      lean = 4 + wave;
      eyes = index === 4 ? "blink" : "wide";
      arms = "peek";
      break;
  }
  const transform = (x, y) => [
    x + (lean * (y - 10)) / 46 + (y >= 29 && y <= 40 ? (x < 25 ? -cheek : x > 40 ? cheek : 0) : 0),
    56 + (y - 56) * bodyScale - lift + (squash * (56 - y)) / 20,
  ];
  const tailTransform = (x, y) => [x + wave, y - lift + (index % 4 === 2 ? 1 : 0)];
  let content = ["tail-cream", "tail-lavender", "tail-mint"]
    .map((id) => shape(id, tailTransform))
    .join("");
  content += shape("body", transform);
  if (dangling) {
    content += rect(25 + lean, 51 - lift, 4, 9 + Math.max(0, wave), "#162B59");
    content += rect(36 + lean, 51 - lift, 4, 9 + Math.max(0, -wave), "#162B59");
    content +=
      rect(11 + lean, 29 - lift, 6, 4, "#162B59") + rect(48 + lean, 29 - lift, 6, 4, "#162B59");
  }
  if (eyes === "open")
    content += ["eye-left", "eye-right"].map((id) => shape(id, transform)).join("");
  else
    for (const x of [25, 36]) {
      const [eyeX, eyeY] = transform(x, eyes === "wide" ? 31 : 35);
      content += rect(eyeX, eyeY, eyes === "wide" ? 5 : 4, eyes === "wide" ? 8 : 2, "#FFCC33");
      if (eyes === "closed")
        content +=
          rect(eyeX - 1, eyeY + 2, 1, 1, "#FFCC33") + rect(eyeX + 4, eyeY + 2, 1, 1, "#FFCC33");
    }
  if (clip.startsWith("poke") && index > 0 && index < 4)
    effects += rect(10, 22, 2, 3, "#FFE6A6") + rect(7, 27, 3, 2, "#FFE6A6");
  if (clip.startsWith("stroke") && index > 1 && index < 6)
    effects += rect(19, 28 - wave, 2, 2, "#B6A0EA") + rect(47, 26 + wave, 2, 2, "#77D9CA");
  if (clip.startsWith("cheek") && cheek > 0)
    content += rect(18 - cheek, 36, 3, 2, "#B6A0EA") + rect(45 + cheek, 36, 3, 2, "#B6A0EA");
  if (clip === "landing" && index < 4)
    effects += rect(19, 57, 5, 1, "#77D9CA") + rect(41, 57, 5, 1, "#77D9CA");
  if (clip === "snack") {
    const cookieY = index < 3 ? 48 - index * 3 : 40;
    if (index < 6) {
      content +=
        rect(30, cookieY, 7 - Math.max(0, index - 3) * 2, 6, "#FFE6A6") +
        rect(32, cookieY - 2, 3, 2, "#FFCC33");
      content += rect(24, cookieY + 2, 5, 3, "#162B59") + rect(38, cookieY + 2, 5, 3, "#162B59");
    }
    if (index > 3 && index < 7)
      effects += rect(29, 47, 1, 1, "#FFE6A6") + rect(36, 49, 1, 1, "#FFE6A6");
  }
  if (mouth) content += rect(30, 43 - Math.max(0, wave), 5, 4 + Math.max(0, wave), "#FFE6A6");
  if (clip === "sleep") {
    content += rect(19, 52, 27, 5, "#77D9CA") + rect(19, 52, 27, 1, "#FFE6A6");
    effects +=
      rect(47, 21 - Math.max(0, wave), 4, 1, "#B6A0EA") +
      rect(50, 22 - Math.max(0, wave), 1, 2, "#B6A0EA") +
      rect(47, 24 - Math.max(0, wave), 4, 1, "#B6A0EA");
  }
  if (clip === "wake" && index > 4)
    effects += rect(15, 18, 2, 4, "#FFE6A6") + rect(12, 21, 4, 1, "#FFE6A6");
  if (arms === "book") {
    content +=
      rect(21, 45, 12, 11, "#FFE6A6") +
      rect(34, 45, 12, 11, "#FFE6A6") +
      rect(32, 44, 2, 13, "#77D9CA");
    for (const x of [23, 36])
      for (const y of [48, 51]) content += rect(x, y, 8 - (index === 3 ? 2 : 0), 1, "#B6A0EA");
    content += rect(17, 46, 5, 4, "#162B59") + rect(45, 46, 5, 4, "#162B59");
  }
  if (arms === "rest") content += rect(20, 53, 9, 3, "#162B59") + rect(38, 53, 9, 3, "#162B59");
  if (["dance", "stretch", "climb", "peek", "walk"].includes(arms)) {
    const armY =
      arms === "stretch"
        ? 23 - Math.max(0, wave)
        : arms === "climb"
          ? 25 + (index % 2) * 6
          : arms === "peek"
            ? 30
            : arms === "walk"
              ? 41 + wave
              : 30 + wave * 2;
    content += rect(13 + lean, armY, 7, 4, "#162B59") + rect(46 + lean, 60 - armY, 7, 4, "#162B59");
  }
  if (feet) {
    const y = feet === "crawl" ? 54 : 54 - lift;
    content +=
      rect(21 + lean, y, 7, 3 + Number(index % 4 < 2) * 3, "#162B59") +
      rect(37 + lean, y, 7, 3 + Number(index % 4 >= 2) * 3, "#162B59");
  }
  if (arms === "cup") {
    const y = index < 4 ? 48 - index * 2 : 42 + Math.max(0, index - 5) * 2;
    content +=
      rect(29, y, 10, 8, "#77D9CA") +
      rect(39, y + 2, 3, 4, "#77D9CA") +
      rect(29, y, 10, 1, "#FFE6A6");
    content += rect(23, y + 3, 5, 3, "#162B59") + rect(41, y + 3, 5, 3, "#162B59");
    if (index < 6)
      effects +=
        rect(31 + (index % 2), y - 6, 1, 3, "#FFE6A6") +
        rect(36 - (index % 2), y - 8, 1, 3, "#FFE6A6");
  }
  if (arms === "gift") {
    const y = 47 - Math.max(0, wave);
    content +=
      rect(26, y, 17, 10, "#B6A0EA") +
      rect(33, y, 3, 10, "#FFE6A6") +
      rect(25, y, 19, 2, "#77D9CA") +
      rect(30, y - 3, 3, 3, "#FFE6A6") +
      rect(36, y - 3, 3, 3, "#FFE6A6");
    content += rect(21, y + 3, 5, 3, "#162B59") + rect(43, y + 3, 5, 3, "#162B59");
    if (index > 3)
      effects += rect(49, 20 + wave, 2, 4, "#FFE6A6") + rect(47, 22 + wave, 5, 1, "#FFE6A6");
  }
  if (clip === "music")
    effects +=
      rect(7, 16 + wave, 2, 5, "#77D9CA") +
      rect(5, 21 + wave, 4, 2, "#77D9CA") +
      rect(9, 16 + wave, 3, 1, "#77D9CA") +
      rect(51, 14 - wave, 2, 5, "#B6A0EA") +
      rect(49, 19 - wave, 4, 2, "#B6A0EA");
  if (clip === "short-fall" && index > 2 && index < 6)
    effects += rect(17, 59, 7, 1, "#77D9CA") + rect(42, 59, 7, 1, "#77D9CA");
  return content + effects;
}

async function renderGroup(group, filePrefix, title) {
  const height = group.length * 64;
  const cells = group.flatMap(([id], row) =>
    Array.from(
      { length: 8 },
      (_, column) =>
        `<g transform="translate(${column * 64} ${row * 64})">${frame(id, column)}</g>`,
    ),
  );
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="${height}" viewBox="0 0 512 ${height}" shape-rendering="crispEdges"><title>${title}</title>${cells.join("")}</svg>\n`;
  const png = await sharp(Buffer.from(svg)).png({ palette: true, effort: 10 }).toBuffer();
  const assetId = createHash("sha256").update(png).digest("hex");
  const animation = {
    clips: group.map(([id, name], row) => ({
      id,
      name,
      fps: 8,
      frames: Array.from({ length: 8 }, (_, column) => ({
        assetId,
        x: column * 64,
        y: row * 64,
        width: 64,
        height: 64,
      })),
    })),
    bindings: filePrefix === "" ? { idle: { clipId: "idle", repeat: true, intervalMs: 5000 } } : {},
    overrides: {},
  };
  // The first atlas is the already shipped stage-1 baseline.
  if (
    filePrefix === "" &&
    assetId !== "3abf03418d1be0bb2a1f4bba9a4e70c02cbc1201ea93cb383906fe489dd37fce"
  ) {
    throw new Error("The original 13-clip atlas changed; preserve its authored frames.");
  }
  await writeFile(new URL(`${filePrefix}atlas.svg`, outputUrl), svg);
  await writeFile(new URL(`${filePrefix}atlas.png`, outputUrl), png);
  await writeFile(
    new URL(`${filePrefix}animation.json`, outputUrl),
    JSON.stringify(animation, null, 2) + "\n",
  );
  return { animation, assetId, png, height };
}
const groups = [];
groups.push(await renderGroup(clips, "", "별꼬리 교감 동작 13개, 행마다 8프레임"));
groups.push(await renderGroup(lifeClips, "life-", "별꼬리 생활 동작 9개, 행마다 8프레임"));
groups.push(await renderGroup(wanderClips, "wander-", "별꼬리 이동 동작 6개, 행마다 8프레임"));
const animation = {
  clips: groups.flatMap((group) => group.animation.clips),
  bindings: {
    ...groups[0].animation.bindings,
    sleep: { clipId: "sleep", repeat: true, intervalMs: 0 },
    focus: { clipId: "focus", repeat: true, intervalMs: 0 },
    rest: { clipId: "rest", repeat: true, intervalMs: 0 },
    musicPlaying: { clipId: "music", repeat: true, intervalMs: 0 },
  },
  overrides: {},
};
if (process.argv.includes("--install")) {
  const motion = (clipId, repeat = false) => ({ mode: "clip", clipId, repeat, intervalMs: 0 });
  const definition = pack.characters[0];
  definition.animation = animation;
  definition.bodyRegions = [
    {
      id: "left-cheek",
      name: "왼쪽 볼",
      x: 0.203125,
      y: 0.484375,
      width: 0.21875,
      height: 0.15625,
      grabPoint: { x: 0.25, y: 0.5625 },
    },
    {
      id: "right-cheek",
      name: "오른쪽 볼",
      x: 0.578125,
      y: 0.484375,
      width: 0.21875,
      height: 0.15625,
      grabPoint: { x: 0.75, y: 0.5625 },
    },
    {
      id: "head",
      name: "머리",
      x: 0.359375,
      y: 0.15625,
      width: 0.28125,
      height: 0.328125,
      grabPoint: { x: 0.5078125, y: 0.15625 },
    },
    {
      id: "body",
      name: "몸",
      x: 0.28125,
      y: 0.640625,
      width: 0.4375,
      height: 0.25,
      grabPoint: { x: 0.5, y: 0.6875 },
    },
  ];
  definition.gestureMotions = [
    {
      id: "poke-head",
      gesture: "poke",
      regionId: "head",
      expression: "호기심",
      start: motion("poke-head"),
    },
    {
      id: "poke-body",
      gesture: "poke",
      regionId: "body",
      expression: "장난",
      start: motion("poke-body"),
    },
    { id: "poke-general", gesture: "poke", expression: "장난", start: motion("poke-body") },
    {
      id: "stroke-head",
      gesture: "stroke",
      regionId: "head",
      expression: "기쁨",
      start: motion("stroke-head"),
    },
    {
      id: "stroke-body",
      gesture: "stroke",
      regionId: "body",
      expression: "평온",
      start: motion("stroke-body"),
    },
    { id: "stroke-general", gesture: "stroke", expression: "기쁨", start: motion("stroke-head") },
    {
      id: "cheek-left",
      gesture: "cheek-grab",
      regionId: "left-cheek",
      expression: "장난",
      start: motion("cheek-start"),
      hold: motion("cheek-hold", true),
      end: motion("cheek-end"),
    },
    {
      id: "cheek-right",
      gesture: "cheek-grab",
      regionId: "right-cheek",
      expression: "장난",
      start: motion("cheek-start"),
      hold: motion("cheek-hold", true),
      end: motion("cheek-end"),
    },
    {
      id: "pickup",
      gesture: "pickup",
      expression: "호기심",
      start: motion("pickup-start"),
      hold: motion("hang-still", true),
      movingHold: motion("hang-moving", true),
      end: motion("landing"),
    },
    { id: "snack", gesture: "snack", expression: "기쁨", start: motion("snack") },
    ...["wake", "drink", "gift", "idle-yawn", "idle-stretch"].map((gesture) => ({
      id: gesture,
      gesture,
      expression: ["drink", "gift"].includes(gesture) ? "기쁨" : "평온",
      start: motion(gesture),
    })),
    ...wanderClips.map(([gesture]) => ({
      id: gesture,
      gesture,
      expression: "호기심",
      hold: motion(gesture, true),
    })),
  ];
  pack.formatVersion = 7;
  pack.animationAssets = groups.map(({ assetId, png, height }) => ({
    sourceId: definition.sourceId,
    assetId,
    mime: "image/png",
    width: 512,
    height,
    data: png.toString("base64"),
  }));
  await writeFile(packUrl, JSON.stringify(pack, null, 2) + "\n");
}
for (const [index, group] of groups.entries()) {
  console.info(
    `Built ${[clips, lifeClips, wanderClips][index].length} clips, ${group.png.length} bytes (${group.assetId}).`,
  );
}
