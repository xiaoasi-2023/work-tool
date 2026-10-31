from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parent.parent
destination = root / 'build'
destination.mkdir(exist_ok=True)
image = Image.new('RGBA', (512, 512), (0, 0, 0, 0))
draw = ImageDraw.Draw(image)
draw.rounded_rectangle((12, 12, 500, 500), radius=100, fill='#247b5b')
draw.rounded_rectangle((115, 128, 397, 384), radius=22, outline='#ffffff', width=19)
draw.line((115, 205, 397, 205), fill='#ffffff', width=17)
draw.line((218, 205, 218, 384), fill='#ffffff', width=17)
draw.ellipse((145, 158, 159, 172), fill='#ffffff')
draw.ellipse((176, 158, 190, 172), fill='#ffffff')
image.save(destination / 'icon.png')
image.save(destination / 'icon.ico', sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print('Generated application icons.')
