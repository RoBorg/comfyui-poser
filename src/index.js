// ComfyUI frontend extension for the "OpenPose 3D Poser" node.

import { PoserEditor } from './editor.js';
import { CSS } from './style.js';

const { app } = window.comfyAPI.app;
const { api } = window.comfyAPI.api;

const NODE_CLASS = 'OpenPose3DPoser';
const WATCHED_WIDGETS = ['width', 'height', 'include_hands', 'include_face'];

if (!document.getElementById('comfyui-poser-style')) {
  document.head.append(Object.assign(document.createElement('style'), { id: 'comfyui-poser-style', textContent: CSS }));
}

const widgetValue = (node, name, fallback) => {
  const w = node.widgets?.find((x) => x.name === name);
  return w && w.value !== undefined && w.value !== null && w.value !== '' ? w.value : fallback;
};

function notifyGraphChanged(node) {
  node.setDirtyCanvas?.(true, true);
  try {
    app.extensionManager?.workflow?.activeWorkflow?.changeTracker?.checkState?.();
  } catch {
    // Older/newer frontends without this API pick up the change on the next mouseup instead.
  }
}

async function promptDialog(title, defaultValue) {
  const dialog = app.extensionManager?.dialog;
  if (dialog?.prompt) {
    try {
      return await dialog.prompt({ title, message: title, defaultValue });
    } catch {
      // fall through to the browser prompt
    }
  }
  return window.prompt(title, defaultValue);
}

async function confirmDialog(message) {
  const dialog = app.extensionManager?.dialog;
  if (dialog?.confirm) {
    try {
      return !!(await dialog.confirm({ title: 'OpenPose 3D Poser', message }));
    } catch {
      // fall through to the browser confirm
    }
  }
  return window.confirm(message);
}

function createHost(node) {
  return {
    api,
    getOutputSize: () => [Number(widgetValue(node, 'width', 512)) || 512, Number(widgetValue(node, 'height', 768)) || 768],
    setOutputSize: (w, h) => {
      for (const [name, value] of [['width', w], ['height', h]]) {
        const widget = node.widgets?.find((x) => x.name === name);
        if (!widget) continue;
        widget.value = value;
        widget.callback?.(value);
      }
      notifyGraphChanged(node);
    },
    getToggles: () => ({ hands: !!widgetValue(node, 'include_hands', true), face: !!widgetValue(node, 'include_face', true) }),
    onChange: () => notifyGraphChanged(node),
    prompt: promptDialog,
    confirm: confirmDialog,
  };
}

app.registerExtension({
  name: 'comfyui-poser.OpenPose3DPoser',

  getCustomWidgets() {
    return {
      POSER_SCENE(node, inputName) {
        const editor = new PoserEditor(createHost(node));
        const widget = node.addDOMWidget(inputName, 'POSER_SCENE', editor.element, {
          getValue: () => editor.getValue(),
          setValue: (value) => editor.setValue(value),
          getMinHeight: () => 400,
          hideOnZoom: false,
        });
        node.poserEditor = editor;
        return { widget };
      },
    };
  },

  nodeCreated(node) {
    if (node.comfyClass !== NODE_CLASS || !node.poserEditor) return;
    const editor = node.poserEditor;
    node.setSize([Math.max(node.size[0], 480), Math.max(node.size[1], 800)]);

    // Re-render when output size / toggles change, however they were changed (widget,
    // properties panel, Vue node, link). Polling a tiny key is cheaper than hooking every path.
    let lastKey = '';
    const timer = setInterval(() => {
      const key = WATCHED_WIDGETS.map((n) => widgetValue(node, n, '')).join('|');
      if (key !== lastKey) {
        lastKey = key;
        editor.requestRender();
      }
    }, 250);

    const onRemoved = node.onRemoved;
    node.onRemoved = function () {
      clearInterval(timer);
      editor.dispose();
      return onRemoved?.apply(this, arguments);
    };

    const onExecuted = node.onExecuted;
    node.onExecuted = function (message) {
      const ref = message?.poser_reference?.[0];
      if (ref) editor.setReference(ref);
      return onExecuted?.apply(this, arguments);
    };
  },
});
