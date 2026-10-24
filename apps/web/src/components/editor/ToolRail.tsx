"use client";

import { Circle, Diamond, Keyboard, Magnet, Move, Rotate3d, Route, Scaling, Search } from "lucide-react";
import { CommandButton } from "../ui";

/** Vertical tool palette (Blender / Maya style): transform tools, path, snapping, keying — each bound to its command. */
export function ToolRail() {
  return (
    <aside className="flex w-11 shrink-0 flex-col items-center gap-1 border-r border-line bg-panel py-2">
      <CommandButton id="object.move" icon={Move} tipSide="right" size="lg" />
      <CommandButton id="object.rotate" icon={Rotate3d} tipSide="right" size="lg" />
      <CommandButton id="object.scale" icon={Scaling} tipSide="right" size="lg" />
      <div className="my-1 h-px w-6 bg-line" />
      <CommandButton id="object.path" icon={Route} tipSide="right" size="lg" />
      <CommandButton id="object.snap" icon={Magnet} tipSide="right" size="lg" />
      <div className="my-1 h-px w-6 bg-line" />
      <CommandButton id="anim.autokey" icon={Diamond} tipSide="right" size="lg" tone="danger" />
      <CommandButton id="anim.record" icon={Circle} tipSide="right" size="lg" tone="danger" />
      <div className="mt-auto flex flex-col items-center gap-1">
        <CommandButton id="view.palette" icon={Search} tipSide="right" size="lg" />
        <CommandButton id="help.shortcuts" icon={Keyboard} tipSide="right" size="lg" />
      </div>
    </aside>
  );
}
