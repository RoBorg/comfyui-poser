"""Projection of 3D keypoints through a pinhole camera and OpenPose-style drawing.

Pure numpy + PIL so it can be unit-tested without ComfyUI. The projection matches a
three.js PerspectiveCamera (vertical FOV, aspect = width / height, looking from
``position`` at ``target`` with +Y up), which is what the browser-side editor uses.
"""

import colorsys
import math

import numpy as np
from PIL import Image, ImageDraw

# OpenPose COCO-18 limb pairs (0-indexed), in the same order/colours as controlnet_aux.
BODY_LIMBS = [
    (1, 2), (1, 5), (2, 3), (3, 4), (5, 6), (6, 7), (1, 8), (8, 9), (9, 10),
    (1, 11), (11, 12), (12, 13), (1, 0), (0, 14), (14, 16), (0, 15), (15, 17),
]
BODY_COLORS = [
    (255, 0, 0), (255, 85, 0), (255, 170, 0), (255, 255, 0), (170, 255, 0),
    (85, 255, 0), (0, 255, 0), (0, 255, 85), (0, 255, 170), (0, 255, 255),
    (0, 170, 255), (0, 85, 255), (0, 0, 255), (85, 0, 255), (170, 0, 255),
    (255, 0, 255), (255, 0, 85), (255, 0, 85),
]
HAND_EDGES = [
    (0, 1), (1, 2), (2, 3), (3, 4), (0, 5), (5, 6), (6, 7), (7, 8),
    (0, 9), (9, 10), (10, 11), (11, 12), (0, 13), (13, 14), (14, 15), (15, 16),
    (0, 17), (17, 18), (18, 19), (19, 20),
]
HAND_EDGE_COLORS = [
    tuple(int(c * 255) for c in colorsys.hsv_to_rgb(i / len(HAND_EDGES), 1.0, 1.0))
    for i in range(len(HAND_EDGES))
]

KEYPOINT_COUNTS = {"body": 18, "right_hand": 21, "left_hand": 21, "face": 70}

DEFAULT_CAMERA = {"position": [0.0, 1.0, 4.5], "target": [0.0, 0.95, 0.0], "fov": 40.0}

# controlnet_aux draws at 512px; scale strokes so larger outputs look the same.
REFERENCE_RESOLUTION = 512.0
NEAR_PLANE = 0.01


def _vec(value, default):
    try:
        arr = np.asarray(value, dtype=np.float64).reshape(3)
        if np.all(np.isfinite(arr)):
            return arr
    except (TypeError, ValueError):
        pass
    return np.asarray(default, dtype=np.float64)


def _points_array(points, count):
    """Convert a list of [x, y, z] / null entries into an (count, 3) array with NaN for gaps."""
    out = np.full((count, 3), np.nan, dtype=np.float64)
    if not isinstance(points, (list, tuple)):
        return out
    for i, p in enumerate(points[:count]):
        if isinstance(p, (list, tuple)) and len(p) >= 3:
            try:
                out[i] = [float(p[0]), float(p[1]), float(p[2])]
            except (TypeError, ValueError):
                pass
    return out


def project_points(points, camera, width, height):
    """Project world-space points to pixel coordinates.

    Returns ``(xy, depth, valid)`` where ``xy`` is (N, 2) pixels, ``depth`` is the
    distance along the view axis and ``valid`` marks points in front of the camera.
    """
    camera = camera or {}
    pos = _vec(camera.get("position"), DEFAULT_CAMERA["position"])
    target = _vec(camera.get("target"), DEFAULT_CAMERA["target"])
    fov = float(camera.get("fov") or DEFAULT_CAMERA["fov"])
    fov = min(max(fov, 1.0), 170.0)

    forward = target - pos
    norm = np.linalg.norm(forward)
    forward = forward / norm if norm > 1e-9 else np.array([0.0, 0.0, -1.0])
    up = np.array([0.0, 1.0, 0.0])
    right = np.cross(forward, up)
    if np.linalg.norm(right) < 1e-6:  # looking straight up/down, same fallback as three.js lookAt
        right = np.cross(forward, np.array([0.0, 0.0, 1.0]) if forward[1] < 0 else np.array([0.0, 0.0, -1.0]))
    right /= np.linalg.norm(right)
    true_up = np.cross(right, forward)

    rel = np.asarray(points, dtype=np.float64) - pos
    xc = rel @ right
    yc = rel @ true_up
    zc = rel @ forward

    tan_half = math.tan(math.radians(fov) / 2.0)
    aspect = width / float(height)
    valid = np.isfinite(zc) & (zc > NEAR_PLANE)
    safe_z = np.where(valid, zc, 1.0)
    ndc_x = xc / (safe_z * tan_half * aspect)
    ndc_y = yc / (safe_z * tan_half)
    px = (ndc_x + 1.0) * 0.5 * width
    py = (1.0 - ndc_y) * 0.5 * height
    xy = np.stack([px, py], axis=-1)
    return xy, zc, valid


def project_scene(scene, width, height, include_hands=True, include_face=True):
    """Project every person in a poser scene dict into 2D keypoints.

    Returns a list of dicts with keys body/right_hand/left_hand/face, each an
    (N, 2) float array with NaN for missing points, plus ``depth`` (mean depth).
    """
    camera = scene.get("camera") or DEFAULT_CAMERA
    people = []
    for person in scene.get("people") or []:
        if not isinstance(person, dict) or person.get("visible") is False:
            continue
        kps = person.get("keypoints") or {}
        projected = {}
        depths = []
        for part, count in KEYPOINT_COUNTS.items():
            if part.endswith("hand") and not include_hands:
                projected[part] = np.full((count, 2), np.nan)
                continue
            if part == "face" and not include_face:
                projected[part] = np.full((count, 2), np.nan)
                continue
            pts = _points_array(kps.get(part), count)
            xy, depth, valid = project_points(pts, camera, width, height)
            xy[~valid] = np.nan
            projected[part] = xy
            if part == "body":
                depths.extend(depth[valid].tolist())
        projected["depth"] = float(np.mean(depths)) if depths else 0.0
        people.append(projected)
    return people


def _ok(p):
    return p is not None and np.all(np.isfinite(p))


def _ellipse_polygon(p1, p2, half_width, steps=72):
    center = (p1 + p2) / 2.0
    delta = p2 - p1
    half_len = np.linalg.norm(delta) / 2.0
    angle = math.atan2(delta[1], delta[0])
    t = np.linspace(0.0, 2.0 * math.pi, steps, endpoint=False)
    ex = half_len * np.cos(t)
    ey = half_width * np.sin(t)
    ca, sa = math.cos(angle), math.sin(angle)
    xs = center[0] + ex * ca - ey * sa
    ys = center[1] + ex * sa + ey * ca
    return [(float(x), float(y)) for x, y in zip(xs, ys)]


def _circle(draw, p, radius, color):
    x, y = float(p[0]), float(p[1])
    draw.ellipse([x - radius, y - radius, x + radius, y + radius], fill=color)


def draw_openpose(people, width, height, line_scale=1.0):
    """Render projected people as an OpenPose control image (PIL RGB)."""
    image = Image.new("RGB", (width, height), (0, 0, 0))
    draw = ImageDraw.Draw(image)
    scale = max(min(width, height) / REFERENCE_RESOLUTION, 0.25) * line_scale
    stick = 4.0 * scale
    body_radius = max(4.0 * scale, 1.0)
    hand_width = max(int(round(2.0 * scale)), 1)
    hand_radius = max(4.0 * scale, 1.0)
    face_radius = max(3.0 * scale, 1.0)

    # Far people first so nearer ones are drawn on top.
    for person in sorted(people, key=lambda p: -p.get("depth", 0.0)):
        body = person["body"]
        for (a, b), color in zip(BODY_LIMBS, BODY_COLORS):
            pa, pb = body[a], body[b]
            if _ok(pa) and _ok(pb):
                dim = tuple(int(c * 0.6) for c in color)
                draw.polygon(_ellipse_polygon(pa, pb, stick), fill=dim)
        for i, color in enumerate(BODY_COLORS[:18]):
            if _ok(body[i]):
                _circle(draw, body[i], body_radius, color)

        for part in ("left_hand", "right_hand"):
            hand = person[part]
            for (a, b), color in zip(HAND_EDGES, HAND_EDGE_COLORS):
                if _ok(hand[a]) and _ok(hand[b]):
                    draw.line([tuple(hand[a]), tuple(hand[b])], fill=color, width=hand_width)
            for p in hand:
                if _ok(p):
                    _circle(draw, p, hand_radius, (0, 0, 255))

        for p in person["face"]:
            if _ok(p):
                _circle(draw, p, face_radius, (255, 255, 255))
    return image


def to_pose_keypoint(people, width, height):
    """Build the POSE_KEYPOINT structure used by comfyui_controlnet_aux (OpenPose JSON)."""

    def flat(points):
        out = []
        for p in points:
            if _ok(p) and 0 <= p[0] < width and 0 <= p[1] < height:
                out.extend([round(float(p[0]), 2), round(float(p[1]), 2), 1.0])
            else:
                out.extend([0.0, 0.0, 0.0])
        return out

    def flat_or_none(points):
        return flat(points) if np.any(np.isfinite(points)) else None

    return [{
        "people": [{
            "pose_keypoints_2d": flat(p["body"]),
            "face_keypoints_2d": flat_or_none(p["face"]),
            "hand_left_keypoints_2d": flat_or_none(p["left_hand"]),
            "hand_right_keypoints_2d": flat_or_none(p["right_hand"]),
        } for p in people],
        "canvas_width": width,
        "canvas_height": height,
    }]
