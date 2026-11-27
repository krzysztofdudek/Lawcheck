import pathlib, re
here = pathlib.Path(__file__).parent
mark = (here.parents[1] / 'brand' / 'mark.svg').read_text().strip()
mark = mark.replace('<svg xmlns="http://www.w3.org/2000/svg" ', '<svg aria-hidden="true" ')
fonts = "@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap');"
(here / 'hero.html').write_text((here / 'hero.src.html').read_text().replace('%%MARK%%', mark).replace('%%FONTS%%', fonts))
