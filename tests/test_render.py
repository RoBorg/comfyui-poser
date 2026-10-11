import importlib.util
import json
import math
import pathlib

import numpy as np
import pytest

# Import the module directly so the tests don't need ComfyUI (folder_paths, torch) on the path.
_spec = importlib.util.spec_from_file_location(
    "openpose_render", pathlib.Path(__file__).resolve().parent.parent / "openpose_render.py"
)
render = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(render)

CAMERA = {"position": [0, 1, 5], "target": [0, 1, 0], "fov": 40}


def test_target_projects_to_image_centre():
    xy, depth, valid = render.project_points(np.array([[0.0, 1.0, 0.0]]), CAMERA, 512, 768)
    assert valid[0]
    assert depth[0] == pytest.approx(5.0)
    assert xy[0] == pytest.approx([256, 384])


def test_projection_matches_vertical_fov():
    # A point at the top edge of the vertical FOV lands on y=0.
    half = math.tan(math.radians(20)) * 5
    xy, _, _ = render.project_points(np.array([[0.0, 1.0 + half, 0.0]]), CAMERA, 512, 768)
    assert xy[0][1] == pytest.approx(0.0, abs=1e-6)
    # Horizontal extent scales with aspect: +X (person's left) appears on the image right.
    xy, _, _ = render.project_points(np.array([[half * 512 / 768, 1.0, 0.0]]), CAMERA, 512, 768)
    assert xy[0][0] == pytest.approx(512.0, abs=1e-6)


def test_points_behind_camera_are_invalid():
    _, _, valid = render.project_points(np.array([[0.0, 1.0, 6.0], [np.nan, 0, 0]]), CAMERA, 512, 512)
    assert not valid.any()


def test_straight_down_camera_does_not_crash():
    cam = {"position": [0, 5, 0], "target": [0, 0, 0], "fov": 40}
    xy, _, valid = render.project_points(np.array([[0.0, 0.0, 0.0]]), cam, 256, 256)
    assert valid[0] and xy[0] == pytest.approx([128, 128])


def _person(offset_x=0.0):
    body = [[offset_x + (i % 3) * 0.1 - 0.1, 0.4 + i * 0.07, 0.0] for i in range(18)]
    hand = [[offset_x + 0.3 + i * 0.005, 1.0, 0.0] for i in range(21)]
    face = [[offset_x + (i % 10) * 0.01 - 0.05, 1.6 + (i // 10) * 0.01, 0.1] for i in range(70)]
    return {"keypoints": {"body": body, "right_hand": hand, "left_hand": hand, "face": face}}


def test_draw_and_keypoints():
    scene = {"camera": CAMERA, "people": [_person(-0.4), _person(0.4)]}
    people = render.project_scene(scene, 512, 768)
    assert len(people) == 2
    img = np.asarray(render.draw_openpose(people, 512, 768))
    assert img.shape == (768, 512, 3)
    assert img.any()
    # Face points are white, hand points are blue.
    assert (img == [255, 255, 255]).all(axis=-1).any()
    assert (img == [0, 0, 255]).all(axis=-1).any()

    kp = render.to_pose_keypoint(people, 512, 768)
    json.dumps(kp)
    assert kp[0]["canvas_width"] == 512 and kp[0]["canvas_height"] == 768
    first = kp[0]["people"][0]
    assert len(first["pose_keypoints_2d"]) == 18 * 3
    assert len(first["hand_right_keypoints_2d"]) == 21 * 3
    assert len(first["face_keypoints_2d"]) == 70 * 3


def test_toggles_remove_hands_and_face():
    scene = {"camera": CAMERA, "people": [_person()]}
    blue = lambda img: int((img == [0, 0, 255]).all(axis=-1).sum())  # noqa: E731
    full = np.asarray(render.draw_openpose(render.project_scene(scene, 512, 512), 512, 512))
    people = render.project_scene(scene, 512, 512, include_hands=False, include_face=False)
    img = np.asarray(render.draw_openpose(people, 512, 512))
    assert not (img == [255, 255, 255]).all(axis=-1).any()
    # Body keypoint 12 is also pure blue, so compare against the render with hands.
    assert blue(img) < blue(full)
    kp = render.to_pose_keypoint(people, 512, 512)[0]["people"][0]
    assert kp["face_keypoints_2d"] is None and kp["hand_left_keypoints_2d"] is None


def test_missing_and_malformed_points_are_skipped():
    scene = {"people": [{"keypoints": {"body": [None, [1, 2], "x"] + [[0, 1, 0]] * 15}}, "junk"]}
    people = render.project_scene(scene, 256, 256)
    assert len(people) == 1
    assert np.isnan(people[0]["body"][0]).all()
    render.draw_openpose(people, 256, 256)


def test_empty_scene_gives_black_image():
    img = np.asarray(render.draw_openpose(render.project_scene({}, 128, 64), 128, 64))
    assert img.shape == (64, 128, 3) and not img.any()
