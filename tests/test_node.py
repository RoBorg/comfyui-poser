"""Runs the node class itself; needs ComfyUI on PYTHONPATH (use `docker compose run --rm test`)."""

import importlib.util
import json
import pathlib
import sys

import pytest

torch = pytest.importorskip("torch")
pytest.importorskip("folder_paths")

ROOT = pathlib.Path(__file__).resolve().parent.parent
FIXTURE = ROOT / "tests" / "fixtures" / "presets.json"


@pytest.fixture(scope="module")
def node_module():
    spec = importlib.util.spec_from_file_location("comfyui_poser", ROOT / "__init__.py", submodule_search_locations=[str(ROOT)])
    pkg = importlib.util.module_from_spec(spec)
    sys.modules["comfyui_poser"] = pkg
    spec.loader.exec_module(pkg)
    return sys.modules["comfyui_poser.poser_node"]


def test_registration(node_module):
    assert "OpenPose3DPoser" in node_module.NODE_CLASS_MAPPINGS
    inputs = node_module.OpenPose3DPoser.INPUT_TYPES()
    assert inputs["required"]["pose_data"][0] == "POSER_SCENE"


def test_render_fixture(node_module):
    node = node_module.OpenPose3DPoser()
    out = node.render(FIXTURE.read_text(), 1024, 512, True, True, 1.0)
    image, keypoints = out["result"]
    assert tuple(image.shape) == (1, 512, 1024, 3)
    assert image.dtype == torch.float32 and 0 < image.max() <= 1
    people = keypoints[0]["people"]
    assert len(people) == len(json.loads(FIXTURE.read_text())["people"])
    assert out["ui"] == {}


def test_reference_image_preview(node_module):
    node = node_module.OpenPose3DPoser()
    ref = torch.rand(1, 64, 48, 3)
    out = node.render("", 128, 128, False, False, 1.0, reference_image=ref)
    ui = out["ui"]["poser_reference"][0]
    assert ui["type"] == "temp" and ui["filename"].endswith(".png")


def test_invalid_json_raises(node_module):
    with pytest.raises(ValueError):
        node_module.OpenPose3DPoser().render("{nope", 64, 64, True, True, 1.0)
