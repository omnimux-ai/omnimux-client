# Clip export API recipes

Load only the sections needed for the current draft. Verify signatures against `../scripts/jy_wrapper.py` before execution.

## Imports and safe project creation

```python
from pathlib import Path
import sys

skill_dir = Path("/absolute/path/to/clip-export")
sys.path.insert(0, str(skill_dir / "scripts"))
from jy_wrapper import JyProject

project = JyProject(
    "Campaign_Cut_20260905_153000",
    width=1080,
    height=1920,
    direct=True,
    overwrite=False,
)
```

Generate a fresh name when the requested name already exists. Use `overwrite=True` only after explicit authorization to replace that exact draft.

## Media and text

```python
project.add_video(
    "/absolute/path/video.mp4",
    start_time="0s",
    source_start="10s",
    duration="5s",
)
project.add_audio(
    "/absolute/path/bgm.mp3",
    start_time="0s",
    volume=0.6,
    track_name="BGM",
)
project.add_text(
    "Title",
    start_time="1s",
    duration="3s",
    font_size=15.0,
    transform_y=0.4,
)
project.add_subtitle("Subtitle", start_time="0s", duration="3s")
project.import_srt("/absolute/path/subtitles.srt", track_name="Subtitles")
```

## Filters, effects, and keyframes

Search the packaged data before using a name:

```bash
python3 <skill-dir>/scripts/asset_search.py "retro"
python3 <skill-dir>/scripts/asset_search.py "fade" -c transitions
```

```python
project.add_filter("<verified name>", start_time="0s", duration="10s")
project.add_effect("<verified name>", start_time="2s", duration="1.5s")

segment = project.add_video(
    "/absolute/path/video.mp4",
    start_time="0s",
    duration="4s",
)
JyProject.add_keyframe(segment, "uniform_scale", "0s", 1.0)
JyProject.add_keyframe(segment, "uniform_scale", "4s", 1.5)
```

Keyframe offsets are relative to `segment` start.

## Save and validate

```python
output_path = project.save()
print(output_path)
```

After execution:

1. assert the returned path exists;
2. inspect the draft directory for current wrapper-required files;
3. verify copied media references resolve;
4. inspect timeline duration and expected tracks/items with the packaged inspector when available;
5. open in the target app through an Agent-controlled surface when available.

Do not convert a structural check into a claim that the target app rendered the draft successfully.

## Time formats and precision

The wrapper accepts numeric seconds, integer microseconds, unit strings such as `"500ms"` and `"1m30s"`, and colon formats. Do not set a clip duration exactly to a rounded probe duration when that can exceed the source by microseconds. Prefer a verified smaller duration or wrapper auto-detection.
