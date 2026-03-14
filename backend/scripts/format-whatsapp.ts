import fs from 'fs';
import path from 'path';

const inputFilePath = path.join(__dirname, '../WhatsApp_Group_selected_list_Linn.csv');
const outputFilePath = path.join(__dirname, '../WhatsApp_Group_selected_list_Linn_formatted.csv');

try {
  const content = fs.readFileSync(inputFilePath, 'utf-8');
  
  const groups = content
    .split(/[\r\n]+/)
    .map(g => g.trim())
    .filter(g => g.length > 0);

  // The UI expects EXACTLY: name, identifier, message
  let csvOutput = `name,identifier,message\n`;
  
  for (const groupName of groups) {
    // For WhatsApp groups, the "identifier" is the group name. We'll set name to the same.
    const safeName = `"${groupName.replace(/"/g, '""')}"`;
    csvOutput += `${safeName},${safeName},""\n`;
  }
  
  fs.writeFileSync(outputFilePath, csvOutput);
  console.log(`Successfully formatted ${groups.length} groups to ${outputFilePath}`);

} catch (err) {
  console.error("Error formatting CSV:", err);
}
