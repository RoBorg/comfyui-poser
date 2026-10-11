export const CSS = `
.poser-root { display: flex; flex-direction: column; width: 100%; height: 100%; box-sizing: border-box;
  font: 11px/1.2 system-ui, sans-serif; color: #d6d9de; background: #15171b; border-radius: 6px; overflow: hidden; user-select: none; }
.poser-toolbar { display: flex; flex-direction: column; gap: 3px; padding: 4px; background: #1f2228; border-bottom: 1px solid #2c3038; }
.poser-row { display: flex; flex-wrap: wrap; gap: 3px; align-items: center; }
.poser-row .poser-sep { width: 1px; align-self: stretch; background: #353a44; margin: 0 2px; }
.poser-root button, .poser-root select { font: inherit; color: inherit; background: #2b2f37; border: 1px solid #3a3f4a;
  border-radius: 4px; padding: 2px 6px; height: 21px; cursor: pointer; }
.poser-root select { padding: 1px 2px; max-width: 110px; }
.poser-root button:hover:not(:disabled), .poser-root select:hover { background: #363b45; }
.poser-root button:disabled { opacity: 0.4; cursor: default; }
.poser-root button.on { background: #3d6fd8; border-color: #5a88ea; color: #fff; }
.poser-seg { display: inline-flex; }
.poser-seg button { border-radius: 0; }
.poser-seg button:first-child { border-radius: 4px 0 0 4px; }
.poser-seg button:last-child { border-radius: 0 4px 4px 0; border-left: none; }
.poser-root label { display: inline-flex; align-items: center; gap: 3px; color: #9aa1ad; }
.poser-root input[type=range] { width: 64px; height: 12px; accent-color: #5a88ea; }
.poser-stage { position: relative; flex: 1; min-height: 0; overflow: hidden; background: #1b1d22; }
.poser-stage.camera { background: #0e0f12; }
.poser-frame { position: absolute; background: #000 no-repeat center / 100% 100%; display: none; }
.poser-stage.camera .poser-frame { display: block; outline: 1px solid #555c68; }
.poser-frame-img { position: absolute; inset: 0; background: no-repeat center / 100% 100%; }
.poser-stage canvas { position: absolute; display: block; outline: none; touch-action: none; }
.poser-status { position: absolute; left: 6px; bottom: 5px; right: 6px; pointer-events: none; color: #aab1bd;
  text-shadow: 0 1px 2px #000; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.poser-badge { position: absolute; top: 5px; right: 6px; pointer-events: none; padding: 1px 5px; border-radius: 3px;
  background: #0009; color: #cfd5de; }
`;
