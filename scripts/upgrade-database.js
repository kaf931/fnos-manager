import { upgradeDatabase } from '../server/upgrade/v1-to-v2.js';
const [source, destination] = process.argv.slice(2);
if (!source || !destination) {
  console.error('用法：node scripts/upgrade-database.js <源 v1.sqlite> <新的目标.sqlite>');
  process.exitCode = 1;
} else {
  try {
    console.log(JSON.stringify(await upgradeDatabase(source, destination), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
