WEB_DIRECTORY = "./web"

# pytest imports this file as a top-level module (no parent package) when collecting tests.
if __package__:
    from .poser_node import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS

    __all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
