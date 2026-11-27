import pathlib, shutil
here = pathlib.Path(__file__).parent
shutil.copy(here / "landing.src.html", here / "landing.html")
