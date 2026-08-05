# Raster asset rendering fix

The illustrated cats and cafe shop items were loaded correctly but their raster sprite elements had no intrinsic width or height, so mobile browsers rendered them at 0 by 0 pixels.

This patch gives pet, cafe, preview, evolution, and shop artwork explicit dimensions and bumps the service worker cache to `cat-trainer-raster-v3`.

The dotted cut lines around family characters are part of the original source sheet and require clean individual transparent art files rather than a CSS fix.
