import { useEffect, useRef, useState, type ReactElement } from "react";
import { Button, Checkbox, Dialog, FormField, Select, TextInput } from "@comet/ui";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import type { DataRecord } from "../toolData";
import { dayLabel, ordinalDay } from "./travelData";
import { placePhoto } from "./travelSummary";
import type { Photo, TripData } from "./travelTypes";
import * as s from "./travel.css";

type PhotoMeta = {
  path: string;
  takenAt: string | null;
  offsetMinutes: number | null;
  lat: number | null;
  lng: number | null;
};

const THUMB = 360;

async function thumbnail(travelId: string, path: string, active: () => boolean): Promise<string | undefined> {
  try {
    const bytes = await command<ArrayBuffer>("travel_photo_original", { path });
    if (!active()) return undefined;
    const url = URL.createObjectURL(new Blob([bytes]));
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      if (!active()) return undefined;
      const scale = Math.min(1, THUMB / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
      const data = canvas.toDataURL("image/jpeg", 0.8).split(",")[1];
      return await command<string>("travel_save_thumb", { travelId, data });
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch {
    // Formats the web view cannot decode still import; they show without a preview.
    return undefined;
  }
}

function Thumb({ travelId, photo, missing }: { travelId: string; photo: Photo; missing: boolean }): ReactElement {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!photo.thumb || !isDesktop()) return;
    let active = true;
    let created: string | null = null;
    void command<ArrayBuffer>("travel_thumb", { travelId, file: photo.thumb })
      .then((bytes) => {
        if (!active) return;
        created = URL.createObjectURL(new Blob([bytes], { type: "image/jpeg" }));
        setUrl(created);
      })
      .catch(() => undefined);
    return () => {
      active = false;
      if (created) URL.revokeObjectURL(created);
    };
  }, [travelId, photo.thumb]);
  return (
    <span className={s.thumb} data-missing={missing}>
      {url ? <img src={url} alt="" /> : <span className={s.caption}>미리보기 없음</span>}
      {photo.cover && <span className={s.badge}>대표</span>}
      {missing && <span className={s.badge}>원본 없음</span>}
    </span>
  );
}

export function TravelPhotos({
  trip,
  busy,
  mutate,
  onOverview,
  onFailure,
}: {
  trip: TripData;
  busy: boolean;
  mutate: (action: string, input: DataRecord) => Promise<boolean>;
  onOverview: () => void;
  onFailure: (message: string) => void;
}): ReactElement {
  const { travel } = trip;
  const lifetime = useRef({ active: true });
  useEffect(() => {
    const current = { active: true };
    lifetime.current = current;
    setProgress(null);
    return () => { current.active = false; };
  }, [travel.id]);

  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [missing, setMissing] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Photo | null>(null);
  const [shifting, setShifting] = useState(false);
  const paths = trip.photos.map((photo) => photo.path).join("\n");
  useEffect(() => {
    if (!isDesktop() || !paths) return;
    let active = true;
    const list = paths.split("\n");
    void command<boolean[]>("travel_paths_exist", { paths: list })
      .then((exists) => {
        if (active) setMissing(new Set(list.filter((_, index) => !exists[index])));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [paths]);

  async function add(): Promise<void> {
    const current = lifetime.current;
    const active = () => current.active && lifetime.current === current;
    try {
      const metas = await command<PhotoMeta[]>("travel_pick_photos", { travelId: travel.id });
      if (!active() || !metas.length) return;
      const known = new Set(trip.photos.map((photo) => photo.path));
      const fresh = metas.filter((meta) => !known.has(meta.path));
      setProgress({ done: 0, total: fresh.length });
      const photos: DataRecord[] = [];
      for (const meta of fresh) {
        if (!active()) return;
        const thumb = await thumbnail(travel.id, meta.path, active);
        if (!active()) return;
        photos.push(placePhoto(meta, trip, thumb) as DataRecord);
        setProgress({ done: photos.length, total: fresh.length });
      }
      for (let index = 0; index < photos.length; index += 100) {
        if (!active()) return;
        if (!(await mutate("travel-photo-add", { travelId: travel.id, photos: photos.slice(index, index + 100) }))) break;
      }
    } catch (cause) {
      if (active()) onFailure(errorText(cause));
    } finally {
      if (active()) setProgress(null);
    }
  }

  const days = new Map<string, Photo[]>();
  for (const photo of [...trip.photos].sort((a, b) => (a.takenAt ?? "").localeCompare(b.takenAt ?? ""))) {
    const key = photo.date ?? "";
    days.set(key, [...(days.get(key) ?? []), photo]);
  }
  const ordered = [...days].sort(([a], [b]) => (a || "9999").localeCompare(b || "9999"));
  const unplaced = trip.photos.filter((photo) => !photo.planId).length;

  return (
    <>
      <div className={s.heading}>
        <h2 className={s.pageTitle}>사진</h2>
        <p className={s.caption}>찍은 시각과 위치로 여행의 날과 장소에 모아요.</p>
      </div>
      {trip.photos.length ? (
        ordered.map(([date, photos]) => (
          <section key={date || "none"} className={s.list} aria-label={date ? dayLabel(date) : "날짜 없는 사진"}>
            <h3 className={s.sectionTitle}>
              {date ? `${ordinalDay(travel, date)} · ${dayLabel(date)}` : "날짜 없는 사진"} · {photos.length}장
            </h3>
            <div className={s.photoGrid}>
              {photos.map((photo) => (
                <button key={photo.id} type="button" className={s.photoButton} disabled={busy} onClick={() => setSelected(photo)}>
                  <Thumb travelId={travel.id} photo={photo} missing={missing.has(photo.path)} />
                  <span className={s.caption}>
                    {photo.takenAt ? photo.takenAt.slice(11) : "시각 없음"}
                    {photo.planId ? ` · ${trip.plans.find((plan) => plan.id === photo.planId)?.title ?? ""}` : ""}
                  </span>
                </button>
              ))}
            </div>
          </section>
        ))
      ) : (
        <div className={s.emptyCard}>
          <p className={s.sectionTitle}>아직 담은 사진이 없어요</p>
          <p className={s.caption}>
            여행을 다녀온 뒤 사진을 모아 보세요.
            <br />
            원본은 옮기지 않고 원래 자리에서 읽어요.
          </p>
        </div>
      )}
      <div className={s.actions}>
        <Button disabled={busy || Boolean(progress)} onClick={() => void add()}>
          {progress ? `미리보기 만드는 중 ${progress.done}/${progress.total}` : "사진 넣기"}
        </Button>
        {trip.photos.some((photo) => photo.takenAt) && (
          <Button variant="ghost" disabled={busy} onClick={() => setShifting(true)}>
            찍은 시각 한꺼번에 옮기기
          </Button>
        )}
        <Button variant="ghost" onClick={onOverview}>
          여행 한눈에
        </Button>
      </div>
      <p className={s.footerRow}>
        <span>{missing.size ? `원본을 찾지 못한 사진 ${missing.size}장` : ""}</span>
        <span>{unplaced ? `위치 없는 사진 ${unplaced}장은 직접 장소를 고를 수 있어요.` : "위치 없는 사진은 직접 장소를 고를 수 있어요."}</span>
      </p>
      {selected && (
        <PhotoEditor
          trip={trip}
          photo={selected}
          missing={missing.has(selected.path)}
          busy={busy}
          onSave={(input) => mutate("travel-photo-update", { ...input, id: selected.id, expected: selected, path: selected.path })}
          onDelete={() => mutate("travel-photo-delete", { id: selected.id, expected: selected })}
          onOpen={() =>
            void command("travel_open_photo", { path: selected.path }).catch((cause: unknown) => onFailure(errorText(cause)))
          }
          onClose={() => setSelected(null)}
        />
      )}
      {shifting && (
        <ShiftDialog
          busy={busy}
          onSave={(minutes) => mutate("travel-photo-shift", { travelId: travel.id, minutes })}
          onClose={() => setShifting(false)}
        />
      )}
    </>
  );
}

function PhotoEditor({
  trip,
  photo,
  missing,
  busy,
  onSave,
  onDelete,
  onOpen,
  onClose,
}: {
  trip: TripData;
  photo: Photo;
  missing: boolean;
  busy: boolean;
  onSave: (input: DataRecord) => Promise<boolean>;
  onDelete: () => Promise<boolean>;
  onOpen: () => void;
  onClose: () => void;
}): ReactElement {
  const [date, setDate] = useState(photo.date ?? "");
  const [planId, setPlanId] = useState(photo.planId ?? "");
  const [cover, setCover] = useState(photo.cover);
  const name = photo.path.split(/[\\/]/).pop() ?? photo.path;
  return (
    <Dialog
      isOpen
      title={name}
      closeLabel="사진 닫기"
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <form
        className={s.form}
        onSubmit={(event) => {
          event.preventDefault();
          void onSave({
            date: date || null,
            planId: planId || null,
            cover,
            takenAt: photo.takenAt ?? null,
            lat: photo.lat ?? null,
            lng: photo.lng ?? null,
          }).then((done) => done && onClose());
        }}
      >
        <Thumb travelId={trip.travel.id} photo={photo} missing={missing} />
        <p className={s.caption}>
          {missing ? "원본이 옮겨졌거나 지워졌어요. 기록과 미리보기만 남아 있어요." : `원본: ${photo.path}`}
        </p>
        <div className={s.fieldRow}>
          <FormField label="날짜">
            <TextInput type="date" value={date} disabled={busy} onChange={(event) => setDate(event.target.value)} />
          </FormField>
          <FormField label="장소">
            <Select value={planId} disabled={busy} onChange={(event) => setPlanId(event.target.value)}>
              <option value="">고르지 않음</option>
              {trip.plans.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {ordinalDay(trip.travel, plan.date)} · {plan.title}
                </option>
              ))}
            </Select>
          </FormField>
        </div>
        <Checkbox checked={cover} disabled={busy} label="여행 대표 사진" onChange={(event) => setCover(event.target.checked)} />
        <div className={s.formActions}>
          <Button variant="danger" className={s.deleteAction} disabled={busy} onClick={() => void onDelete().then((done) => done && onClose())}>
            여행에서 빼기
          </Button>
          {!missing && (
            <Button variant="ghost" onClick={onOpen}>
              원본 열기
            </Button>
          )}
          <Button type="submit" disabled={busy}>
            저장
          </Button>
        </div>
        <p className={s.caption}>여행에서 빼도 원본 파일은 지우지 않아요.</p>
      </form>
    </Dialog>
  );
}

function ShiftDialog({
  busy,
  onSave,
  onClose,
}: {
  busy: boolean;
  onSave: (minutes: number) => Promise<boolean>;
  onClose: () => void;
}): ReactElement {
  const [hours, setHours] = useState("1");
  const value = Math.round(Number(hours) * 60);
  const valid = Number.isFinite(value) && value !== 0 && Math.abs(value) <= 48 * 60;
  return (
    <Dialog
      isOpen
      size="small"
      title="찍은 시각 옮기기"
      closeLabel="찍은 시각 옮기기 닫기"
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <form
        className={s.form}
        onSubmit={(event) => {
          event.preventDefault();
          if (valid) void onSave(value).then((done) => done && onClose());
        }}
      >
        <FormField
          label="옮길 시간"
          description="카메라 시계가 틀렸을 때 모든 사진을 한 번에 당기거나(음수) 미뤄요. 날짜도 함께 바뀌어요."
        >
          <TextInput type="number" step="0.5" min={-48} max={48} value={hours} disabled={busy} onChange={(event) => setHours(event.target.value)} />
        </FormField>
        <div className={s.formActions}>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            취소
          </Button>
          <Button type="submit" disabled={busy || !valid}>
            {valid ? `${Math.abs(value / 60)}시간 ${value > 0 ? "미루기" : "당기기"}` : "옮기기"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
