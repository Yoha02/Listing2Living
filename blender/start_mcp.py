"""Start the installed Blender MCP add-on for this Blender session only.

Launch Blender normally with --python blender/start_mcp.py, not --background:
the installed add-on processes socket requests through Blender's UI timer loop.
No preferences are saved and no third-party asset services are enabled.
"""
import bpy


def start():
    if 'addon' not in bpy.context.preferences.addons:
        bpy.ops.preferences.addon_enable(module='addon')
    bpy.context.scene.blendermcp_port = 9876
    bpy.app.driver_namespace['listing2living_managed_session'] = True
    bpy.ops.blendermcp.start_server()
    print('LISTING2LIVING_MCP_READY localhost:9876')
    return None


bpy.app.timers.register(start, first_interval=1)
