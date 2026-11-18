import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
const resolveBundle = createRequire(pathToFileURL(process.env.VALO_BUNDLED_NODE + '/resolve.cjs'));
const { Workbook, SpreadsheetFile } = await import(pathToFileURL(resolveBundle.resolve('@oai/artifact-tool')).href);

const workbook = Workbook.create();
const source = 'https://docs.google.com/document/d/1ZmWio1qKgFKK4UFroTvAXuoNvQBr-JfJRWpOWsrhl8o/edit';
const dates = [
  ['20/08','02/09'], ['03/09','16/09'], ['17/09','30/09'],
  ['01/10','14/10'], ['15/10','28/10'], ['29/10','11/11'],
  ['12/11','25/11'], ['26/11','09/12'], ['10/12','15/12'],
];
const milestones = [
  'Kiến trúc lõi, RBAC, quản lý xe, YOLOv8 và OCR cà vẹt',
  'Ví PayOS, dựng ô đỗ 2D/3D và giữ chỗ khi booking',
  'Kiosk vào/ra, AI nhận diện biển số và hợp đồng PDF',
  'Xử lý trạng thái PAUSED, quá giờ và cải thiện ứng dụng mobile',
  'Cảm biến vị trí đỗ ESP32, siêu âm/hồng ngoại và đồng bộ MQTT',
  'Barrier IoT servo/relay và lắp ráp khung mô hình',
  'Đồng bộ mô hình vật lý, giảm độ trễ dưới 1 giây và xử lý khi hệ thống gặp lỗi',
  'Kiểm tra, ổn định toàn hệ thống và UAT cùng mentor',
  'Bảo vệ và phát hành cuối',
];
const tasks = [
  [],
  [
    ['Rà soát giao diện web và app theo các vai trò','Thanh, Trân, Hưng','Buổi 8, 08–10/09. Trân phụ trách điều phối UI/UX.'],
    ['Kiểm tra kiosk check-in/check-out và chuẩn bị IoT','Vỹ, Khôi','Buổi 8, 08–10/09.'],
    ['Nghiên cứu đặt chỗ bằng prompt/giọng nói và kiểm thử booking','Thanh, Khôi','Buổi 9, 11–17/09. Thanh phụ trách booking. Khôi hỗ trợ nghiên cứu tích hợp.'],
    ['Nghiên cứu phương án thanh toán qua VETC','Thanh','Buổi 9, 11–17/09. Hạng mục nghiên cứu.'],
    ['Nghiên cứu AI theo vai trò, voucher và điểm tích lũy','Trân, Hưng','Buổi 9, 11–17/09. Gồm thống kê mật độ và trao đổi Staff–Admin khi có vấn đề.'],
    ['Nghiên cứu thông báo SMS và Zalo','Khôi','Buổi 9, 11–17/09.'],
  ],
  [
    ['Rà soát package, database, sequence và class diagram','Trân, Thanh, Khôi','Buổi 10, 21–25/09. Trân điều phối, Vỹ kiểm tra và hỗ trợ.'],
    ['Xây dựng bãi xe và cập nhật camera phát hiện đỗ sai ô','Vỹ','Buổi 10, 21–25/09.'],
    ['Hoàn thiện Reports 4 và 5','Trân','Buổi 11, 30/09.'],
    ['Bổ sung Report 5','Thanh, Khôi, Hưng','Buổi 11, 30/09. Nhóm cập nhật unit test và test report.'],
    ['Chỉnh sơ đồ doanh thu','Khôi','Buổi 11, 30/09.'],
    ['Nghiên cứu và chỉnh voucher','Hưng','Buổi 11, 30/09.'],
  ],
  [],
  [
    ['Cải thiện AI booking, kiểm thử đặt nhiều ngày và cách tính giá','Thanh','Buổi 12, 17/10. Phối hợp Trân kiểm thử.'],
    ['Cập nhật xử lý thông báo và subscription','Trân','Buổi 12, 17/10.'],
    ['Đồng bộ tính năng và giao diện mobile, cải thiện Google Sign-In','Khôi, Hưng','Buổi 12, 17/10. Kiểm tra cả ba vai trò.'],
    ['Kiểm tra luồng chuyển nhượng ô đỗ','Khôi','Buổi 12, 17/10.'],
  ],
  [
    ['Làm mô hình IoT và hướng dẫn Authentication and User Management','Vỹ','Buổi 14, 29/10. Phân công Report 6.'],
    ['Sửa booking VIP/thường và kiểm thử AI booking','Thanh','Buổi 14, 29/10. Report 6: Wallet and Payment, Notification, Booking.'],
    ['Hoàn thiện Telegram, OAuth và kiểm thử mobile','Khôi','Buổi 14, 29/10. Report 6: Vehicle Management.'],
    ['Bổ sung chuyển ngôn ngữ, chỉnh UI và kiểm thử web/app','Hưng','Buổi 14, 29/10. Report 6: Administration, Parking Information.'],
    ['Đồng bộ UI Admin/Staff, thử membership và thông báo','Trân','Buổi 14, 29/10. Report 6: Membership, Parking Operations, AI-Assisted Services, Service and Ticket Package, Parking Session and Kiosk.'],
    ['Cập nhật Report 3 và mô tả module Voucher Management','Trân, Hưng','Buổi 16, 10/11. Trân làm Report 3, phối hợp Hưng cho voucher.'],
    ['Sửa lỗi AI booking, đặt nhiều xe và giao diện xác nhận','Thanh','Buổi 16, 10/11.'],
  ],
  [
    ['Gắn cờ tài khoản có ba đơn sát ngưỡng hoàn 100% và rà soát chống spam','Thanh','Buổi 17, 16/11.'],
    ['Đối chiếu Reports 1 và 3 với frontend, cập nhật sơ đồ Report 4','Trân, Thanh','Buổi 17, 16/11. Vẽ sequence/class sau khi hoàn tất Report 3.'],
    ['Bổ sung test case Report 5 và workflow Report 6','Cả nhóm','Buổi 17, 16/11.'],
    ['Cập nhật báo cáo tuần từ biên bản và lịch sprint','Hưng','Buổi 17, 16/11.'],
    ['Cập nhật sơ đồ screen flow','Khôi','Buổi 17, 16/11.'],
  ],
  [], [],
];
const issues = {
  1: [['Cần rà soát UI và luồng theo vai trò','Thanh, Trân, Hưng','Buổi 8. Rà soát dữ liệu nhập và hành vi trên web/mobile.']],
  5: [['AI booking trả sai chủ đề hoặc không xử lý được một số khoảng ngày','Thanh','Buổi 16. Kiểm thử voucher, khoảng ngày dài và nhiều xe.']],
  6: [['Cần rà soát chống spam và hành vi hoàn tiền','Thanh','Buổi 17. Kiểm tra tài khoản có ba đơn sát ngưỡng hoàn 100%.']],
};
const formatDate = (value) => `${value}/2026`;
for (let i = 0; i < dates.length; i++) {
  const name = i < 8 ? `Sprint ${i + 1}` : 'Final Release';
  const sheet = workbook.worksheets.add(name);
  const row = (r, values) => { sheet.getRangeByIndexes(r-1,0,1,5).values = [values]; };
  const banner = (r, text, dark = false) => {
    const range = sheet.getRange(`A${r}:E${r}`);
    range.merge();
    row(r,[text,null,null,null,null]);
    range.format.fill = dark ? '#163B56' : '#D8EAF1';
    range.format.font = {bold:true,color:dark ? '#FFFFFF' : '#163B56'};
    range.format.rowHeightPx = 27;
  };
  const append = (r, line, height=52) => {
    row(r,line);
    const range=sheet.getRange(`A${r}:E${r}`);
    range.format.rowHeightPx=height;
    range.format.fill=r%2 ? '#F1F7FA' : '#FFFFFF';
  };
  const [start,end] = dates[i].map(formatDate);
  const area=sheet.getRange('A1:E35');
  area.format.font={name:'Arial',size:11};
  area.format.wrapText=true;
  area.format.verticalAlignment='center';
  [55,350,155,125,455].forEach((width,col) => {
    sheet.getRangeByIndexes(0,col,35,1).format.columnWidthPx=width;
  });
  banner(1,`PROJECT REPORT · ${name}`,true);
  banner(2,'Group SP26-SE07');
  banner(3,`Date   ${start} – ${end}`);
  banner(4,'I. Status Report');
  row(5,['#','Project Task','In-charge','Status','Notes']);
  append(6,[1,milestones[i],'','Milestone','Mốc kế hoạch theo ảnh 8 Sprint Milestone Timeline.'],47);
  let r=7;
  for(const [task,owner,note] of tasks[i]){
    if (!owner) throw Error('Missing meeting owner');
    append(r,[r-5,task,owner,'Đã phân công',note],65);
    r++;
  }
  if(!tasks[i].length) append(r++,['','Chưa có phân công xác nhận trong phần biên bản đối chiếu.','','','']);
  banner(r++,'II. Project Issues');
  row(r++,['#','Project Issue','Owner','Status','Notes']);
  if(issues[i]){
    for(const [issue,owner,note] of issues[i]) append(r++,[1,issue,owner,'Cần rà soát',note]);
  } else append(r++,['','Chưa có vấn đề xác nhận cho kỳ này.','','',''],34);
  banner(r++,'III. Next Period Plan');
  row(r++,['#','Project Work Item','In-charge','Deadline','Notes']);
  if(i+1<dates.length) append(r++,[1,milestones[i+1],'',formatDate(dates[i+1][1]),'Hạn theo milestone kế tiếp.'],47);
  else append(r++,['','Mốc cuối của timeline.','','',''],34);
  banner(r++,'IV. Other Project Matters / Suggestions');
  append(r++,['','Biên bản cuộc họp','','',source],38);
}
const preview = await workbook.render({sheetName:'Sprint 6',range:'A1:E24',scale:1,format:'png'});
await fs.writeFile(new URL('./preview.png',import.meta.url),new Uint8Array(await preview.arrayBuffer()));
const file=await SpreadsheetFile.exportXlsx(workbook);
await file.save(fileURLToPath(new URL('./VALOParking_Weekly_Report_Milestones.xlsx',import.meta.url)));
