import fs from "node:fs/promises";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const dir = "D:/ki7/WDP/Valo_Parking/outputs/hsh_test_report";
const blob = await FileBlob.load(dir + "/Report5_Test_Report_Ho_Sy_Hung.xlsx");
const book = await SpreadsheetFile.importXlsx(blob);
for (const [name, range, slug] of [
  ["27. login", "A9:O26", "login"],
  ["40. renewSubscription", "A9:O28", "renewal"],
  ["56. StaffTicketPackagesScreen", "A9:O24", "ticket-packages"],
]) {
  const preview = await book.render({ sheetName: name, range, scale: 1, format: "png" });
  await fs.writeFile(dir + "/preview_" + slug + ".png", new Uint8Array(await preview.arrayBuffer()));
  console.log("rendered", name);
}
