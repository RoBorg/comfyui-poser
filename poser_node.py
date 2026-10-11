import json
import os
import random

import numpy as np
import torch
from PIL import Image

import folder_paths

from .openpose_render import draw_openpose, project_scene, to_pose_keypoint


class OpenPose3DPoser:
    """Poseable 3D skeleton(s) + camera, rendered as an OpenPose control image."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                # Edited by the 3D viewport widget (web/js/poser.js); stored as a JSON string.
                "pose_data": ("POSER_SCENE", {"default": ""}),
                "width": ("INT", {"default": 512, "min": 64, "max": 8192, "step": 8}),
                "height": ("INT", {"default": 768, "min": 64, "max": 8192, "step": 8}),
                "include_hands": ("BOOLEAN", {"default": True, "label_on": "hands", "label_off": "no hands"}),
                "include_face": ("BOOLEAN", {"default": True, "label_on": "face", "label_off": "no face"}),
                "line_thickness": ("FLOAT", {"default": 1.0, "min": 0.25, "max": 4.0, "step": 0.05}),
            },
            "optional": {
                "reference_image": ("IMAGE", {"tooltip": "Shown behind the skeleton in camera view after the node runs."}),
            },
        }

    RETURN_TYPES = ("IMAGE", "POSE_KEYPOINT")
    RETURN_NAMES = ("pose_image", "pose_keypoint")
    FUNCTION = "render"
    CATEGORY = "image/pose"
    DESCRIPTION = "Pose 3D OpenPose skeletons and a camera in the node's viewport; outputs an OpenPose image for ControlNet."

    def render(self, pose_data, width, height, include_hands, include_face, line_thickness, reference_image=None):
        scene = parse_scene(pose_data)
        people = project_scene(scene, width, height, include_hands=include_hands, include_face=include_face)
        image = draw_openpose(people, width, height, line_scale=line_thickness)
        tensor = torch.from_numpy(np.asarray(image, dtype=np.float32) / 255.0)[None, ...]
        keypoints = to_pose_keypoint(people, width, height)

        ui = {}
        if reference_image is not None:
            ui["poser_reference"] = [save_temp_preview(reference_image[0])]
        return {"ui": ui, "result": (tensor, keypoints)}


def parse_scene(pose_data):
    if isinstance(pose_data, dict):
        return pose_data
    if not pose_data:
        return {}
    try:
        scene = json.loads(pose_data)
    except (TypeError, ValueError) as e:
        raise ValueError(f"OpenPose 3D Poser: invalid pose_data JSON ({e})") from e
    return scene if isinstance(scene, dict) else {}


def save_temp_preview(image_tensor):
    temp_dir = folder_paths.get_temp_directory()
    os.makedirs(temp_dir, exist_ok=True)
    filename = f"poser_ref_{random.getrandbits(48):012x}.png"
    array = np.clip(image_tensor.cpu().numpy() * 255.0, 0, 255).astype(np.uint8)
    Image.fromarray(array).save(os.path.join(temp_dir, filename), compress_level=1)
    return {"filename": filename, "subfolder": "", "type": "temp"}


NODE_CLASS_MAPPINGS = {"OpenPose3DPoser": OpenPose3DPoser}
NODE_DISPLAY_NAME_MAPPINGS = {"OpenPose3DPoser": "OpenPose 3D Poser"}
