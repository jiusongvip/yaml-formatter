import os

# Fix BaseLayout CSS import
p = os.path.join(os.path.dirname(__file__) if '__file__' in dir() else '.', 'src', 'layouts', 'BaseLayout.astro')
p = 'src/layouts/BaseLayout.astro'

with open(p, 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace("'~/styles/global.css'", "'../styles/global.css'")

with open(p, 'w', encoding='utf-8') as f:
    f.write(content)

print("Fixed BaseLayout CSS import")

# Fix ToolPanel
p2 = 'src/components/ToolPanel.tsx'
with open(p2, 'r', encoding='utf-8') as f:
    c2 = f.read()

if 'import React' not in c2:
    c2 = c2.replace("import { useState", "import React, { useState")
    with open(p2, 'w', encoding='utf-8') as f:
        f.write(c2)
    print("Fixed ToolPanel React import")
else:
    print("ToolPanel already has React import")

# Also fix ~/ in index.astro if present
for fname in ['src/pages/index.astro', 'src/pages/privacy.astro']:
    try:
        with open(fname, 'r', encoding='utf-8') as f:
            fc = f.read()
        if "'~/styles/global.css'" in fc or '"~/styles/global.css"' in fc:
            fc = fc.replace("'~/styles/global.css'", "'../styles/global.css'")
            fc = fc.replace('"~/styles/global.css"', '"../styles/global.css"')
            with open(fname, 'w', encoding='utf-8') as f:
                f.write(fc)
            print(f"Fixed {fname}")
    except FileNotFoundError:
        pass

print("All fixes applied")
