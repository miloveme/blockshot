"use client";

import { Boxes, Clapperboard, Film, FolderTree, Info, Layers, PanelLeftClose, PanelRightClose, Settings2, SlidersHorizontal, Sparkles } from "lucide-react";
import { ASPECT_PRESETS, aspectLabel } from "@blockshot/core";
import { useStudio } from "@/lib/store";
import { setDock, useUi } from "@/lib/ui";
import { setAspect } from "@/lib/actions";
import { cx, IconButton, PanelSection, TabBar } from "../ui";
import { NumField, Row, SelectField, TextField } from "../fields";
import { Outliner } from "./Outliner";
import { AssetPanel } from "../AssetPanel";
import { Properties } from "../Properties";
import { ShotEditor } from "../ShotEditor";
import { ImportPanel } from "../ImportPanel";
import { RenderPanel } from "../RenderPanel";
import { SpaceEditor } from "../SpaceEditor";

/** Drag handle between docks. `axis` x resizes a side panel, y the timeline. */
export function ResizeHandle({ axis, onDelta }: { axis: "x" | "y"; onDelta: (d: number) => void }) {
  return (
    <div
      role="separator"
      aria-orientation={axis === "x" ? "vertical" : "horizontal"}
      onPointerDown={(e) => {
        e.preventDefault();
        let last = axis === "x" ? e.clientX : e.clientY;
        const move = (ev: PointerEvent) => {
          const now = axis === "x" ? ev.clientX : ev.clientY;
          onDelta(now - last);
          last = now;
        };
        const up = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
          document.body.style.cursor = "";
        };
        document.body.style.cursor = axis === "x" ? "col-resize" : "row-resize";
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      }}
      className={cx(
        "group relative z-10 shrink-0 bg-transparent",
        axis === "x" ? "-mx-[3px] w-[6px] cursor-col-resize" : "-my-[3px] h-[6px] cursor-row-resize",
      )}
    >
      <span className={cx("absolute bg-accent/0 transition-colors group-hover:bg-accent/60", axis === "x" ? "inset-y-0 left-[2px] w-[2px]" : "inset-x-0 top-[2px] h-[2px]")} />
    </div>
  );
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** In a narrow window a panel is a drawer over the viewport: never wider than the window leaves room for. */
const drawerWidth = (w: number) => `min(${w}px, calc(100vw - 96px))`;

export function LeftDock({ drawer = false }: { drawer?: boolean }) {
  const tab = useUi((s) => s.leftTab);
  const width = useUi((s) => s.leftWidth);
  const set = useUi((s) => s.set);
  return (
    <>
      <aside className={cx("flex shrink-0 flex-col border-r border-line bg-panel", drawer && "shadow-[var(--shadow-pop)]")} style={{ width: drawer ? drawerWidth(width) : width }}>
        <TabBar
          value={tab}
          onChange={(v) => set({ leftTab: v })}
          tabs={[
            { value: "outliner", label: "아웃라이너", icon: FolderTree },
            { value: "assets", label: "에셋", icon: Boxes },
          ]}
          right={<IconButton icon={PanelLeftClose} size="sm" label="왼쪽 패널 닫기" kbd="Alt+1" onClick={() => setDock("left", false)} />}
        />
        {tab === "outliner" ? (
          <Outliner />
        ) : (
          <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-3 text-sm">
            <AssetPanel />
          </div>
        )}
      </aside>
      <ResizeHandle axis="x" onDelta={(d) => set({ leftWidth: clamp(useUi.getState().leftWidth + d, 200, 420) })} />
    </>
  );
}

const RIGHT_TABS = [
  { value: "scene" as const, label: "속성", icon: SlidersHorizontal },
  { value: "shots" as const, label: "샷", icon: Clapperboard },
  { value: "ai" as const, label: "AI", icon: Sparkles },
  { value: "render" as const, label: "렌더", icon: Film },
];

export function RightDock({ drawer = false }: { drawer?: boolean }) {
  const panel = useStudio((s) => s.panel);
  const setPanel = useStudio((s) => s.setPanel);
  const selection = useStudio((s) => s.selection);
  const width = useUi((s) => s.rightWidth);
  const seq = useUi((s) => s.aiDraftSeq);
  const set = useUi((s) => s.set);
  const tab = panel === "assets" ? "scene" : panel;
  return (
    <>
      <ResizeHandle axis="x" onDelta={(d) => set({ rightWidth: clamp(useUi.getState().rightWidth - d, 280, 520) })} />
      <aside className={cx("flex shrink-0 flex-col border-l border-line bg-panel", drawer && "shadow-[var(--shadow-pop)]")} style={{ width: drawer ? drawerWidth(width) : width }}>
        <TabBar value={tab} onChange={setPanel} tabs={RIGHT_TABS} right={<IconButton icon={PanelRightClose} size="sm" label="오른쪽 패널 닫기" kbd="Alt+2" tipSide="bottom-end" onClick={() => setDock("right", false)} />} />
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto text-sm text-ink-2">
          {tab === "scene" ? selection ? <Properties /> : <SceneInspector /> : null}
          {tab === "shots" ? (
            <div className="p-3">
              <ShotEditor />
            </div>
          ) : null}
          {tab === "ai" ? (
            <div className="p-3">
              <ImportPanel key={seq} onClose={() => setPanel("scene")} />
            </div>
          ) : null}
          {tab === "render" ? (
            <div className="p-3">
              <RenderPanel />
            </div>
          ) : null}
        </div>
      </aside>
    </>
  );
}

/** What the inspector shows with nothing selected: the project itself — output settings and the space. */
function SceneInspector() {
  const spec = useStudio((s) => s.spec);
  const edit = useStudio((s) => s.edit);
  const { duration, fps, resolution } = spec.settings;
  const setSettings = (p: Partial<typeof spec.settings>) => edit((s) => ({ ...s, settings: { ...s.settings, ...p } }));
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2.5 border-b border-line px-3 py-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-raised ring-1 ring-line">
          <Layers size={17} className="text-accent" strokeWidth={1.75} />
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-ink">{spec.meta.title}</div>
          <div className="text-[10px] text-ink-3">
            장면 · 인물 {spec.actors.length} · 소품 {spec.props.length} · 카메라 {spec.cameras.length} · 샷 {spec.shots.length}
          </div>
        </div>
      </div>
      <PanelSection id="project" title="출력" icon={Settings2}>
        <Row label="제목">
          <TextField value={spec.meta.title} onCommit={(v) => v.trim() && edit((s) => ({ ...s, meta: { ...s.meta, title: v.trim() } }))} />
        </Row>
        <Row label="길이 (초)">
          <NumField value={duration} min={0.5} max={600} step={0.5} digits={1} onCommit={(v) => setSettings({ duration: v })} />
        </Row>
        <Row label="프레임레이트">
          <SelectField value={String(fps)} options={["24", "25", "30", "48", "60"].map((v) => ({ value: v, label: `${v} fps` }))} onCommit={(v) => setSettings({ fps: Number(v) })} />
        </Row>
        <Row label="화면비">
          <SelectField
            value={aspectLabel(resolution) ?? "custom"}
            options={[...(aspectLabel(resolution) ? [] : [{ value: "custom", label: resolution.join("×") }]), ...ASPECT_PRESETS.map((a) => ({ value: a.label, label: `${a.label}` }))]}
            onCommit={(v) => {
              const a = ASPECT_PRESETS.find((p) => p.label === v);
              if (a) setAspect(a.ratio);
            }}
          />
        </Row>
        <Row label="해상도">
          <span className="font-mono text-xs text-ink-2">{resolution.join(" × ")}</span>
        </Row>
      </PanelSection>
      <PanelSection id="space" title="공간 · 방 구조" icon={Layers}>
        <SpaceEditor />
      </PanelSection>
      <PanelSection id="tips" title="시작하기" icon={Info} defaultOpen={false}>
        <ul className="flex list-disc flex-col gap-1 pl-4 text-xs leading-relaxed text-ink-3">
          <li>왼쪽 <b className="text-ink-2">에셋</b>에서 고른 뒤 바닥을 클릭해 배치합니다.</li>
          <li>오브젝트를 선택하면 이 패널이 그 속성으로 바뀝니다. 우클릭하면 메뉴가 나옵니다.</li>
          <li><b className="text-ink-2">⌘K</b>로 모든 명령을 찾고, 그냥 적으면 AI에게 요청합니다.</li>
        </ul>
      </PanelSection>
    </div>
  );
}
