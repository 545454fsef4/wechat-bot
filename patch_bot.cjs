const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src', 'platforms', 'wechat', 'bot.js');
let content = fs.readFileSync(filePath, 'utf8');

const oldSearch = `const contactList = await bot.Contact.findAll()
        const target = contactList.find((c) => (c.alias() && c.alias().includes(contact)) || c.name().includes(contact))
        if (!target) {`;

const newSearch = `const contactList = await bot.Contact.findAll()
        let target = null;
        for (const c of contactList) {
          const alias = await c.alias();
          const name = c.name();
          if ((alias && alias.includes(contact)) || name.includes(contact)) {
            target = c;
            break;
          }
        }
        if (!target) {`;

if (content.includes(oldSearch)) {
  content = content.replace(oldSearch, newSearch);
  fs.writeFileSync(filePath, content, 'utf8');
  console.log('PATCHED: Contact search now handles async alias()');
} else {
  console.log('WARN: Could not find the old search pattern in file');
  console.log('File contents around "find(":');
  const idx = content.indexOf('.find(');
  if (idx >= 0) {
    console.log(content.substring(Math.max(0, idx - 120), idx + 200));
  }
}
