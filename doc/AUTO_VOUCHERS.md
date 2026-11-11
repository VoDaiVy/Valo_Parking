# Voucher theo chi tiêu và cấp trực tiếp

Trang **Admin → Vouchers** có hai phần:

- **Tự động theo chi tiêu:** admin chỉnh mốc, số tiền giảm, giá trị booking tối thiểu, rồi bật chương trình. Mặc định chương trình tắt. Lần bật đầu tiên xác định thời điểm bắt đầu; hệ thống không phát thưởng cho giao dịch cũ.
- **Gửi trực tiếp:** admin tạo mẫu voucher giảm tiền, giảm phần trăm hoặc miễn phí dịch vụ, tìm khách hàng theo tên/email, chọn tối đa 100 tài khoản và gửi. Mỗi người nhận một voucher riêng. Giới hạn số lượng của mẫu được kiểm tra trước khi cấp.

Mốc mặc định là 300.000đ → 20.000đ (đơn từ 100.000đ), 700.000đ → 50.000đ (đơn từ 200.000đ), và 1.500.000đ → 100.000đ (đơn từ 400.000đ). Mỗi tháng theo giờ Việt Nam, một mốc chỉ được nhận một lần. Nếu một giao dịch vượt nhiều mốc, chỉ phát voucher của mốc cao nhất vừa đạt. Thay đổi mốc không phát bù cho giao dịch đã xử lý. Trong lúc tắt chương trình, chi tiêu vẫn được ghi nhận; giao dịch đủ điều kiện tiếp theo sau khi bật lại sẽ xét thưởng.

Chỉ tính tiền thực trả của booking đã thanh toán (không cần đợi kết thúc phiên), phiên gửi xe đã thanh toán, mua/gia hạn gói và gia hạn chỗ VIP. Không tính nạp ví, chuyển tiền, tiền phạt hoặc phiên gửi xe đã thuộc một booking/gói miễn phí. Hoàn tiền làm giảm chi tiêu; voucher thưởng chưa dùng và chưa giữ cho booking có thể bị thu hồi. Voucher đã dùng hoặc đã giữ cho một booking hợp lệ vẫn được tôn trọng. Các nguồn thanh toán được đối chiếu lại mỗi phút; mỗi giao dịch chỉ ghi nhận một lần qua khóa nguồn duy nhất.

Voucher được gắn với tài khoản, dùng một lần cho booking đạt số tiền tối thiểu và hết hạn đúng **7 × 24 giờ** kể từ lúc cấp. Một booking dùng tối đa một voucher. Voucher thưởng chi tiêu chỉ áp dụng cho booking tạo sau lúc cấp. Voucher đã đổi bằng điểm từ trước vẫn dùng đến hết hạn; điểm cũ được giữ trong dữ liệu lịch sử nhưng không còn được tích hoặc đổi.

Việc cấp voucher, tạo thông báo trong ứng dụng và tạo yêu cầu gửi email nằm trong cùng transaction MongoDB. Email được gửi sau khi transaction hoàn tất; lỗi SMTP sẽ được thử lại với khoảng nghỉ tăng dần. Cần cấu hình `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_USER`, `EMAIL_PASS` và `CLIENT_URL` như các email hiện có. MongoDB cần hỗ trợ transactions (replica set, bao gồm single-node replica set). Khi vận hành nhiều backend instance, khóa duy nhất trên voucher, nguồn chi tiêu và yêu cầu gửi bảo vệ khỏi phát trùng.

Kiểm thử:

```sh
cd backend && npm run test:vouchers
cd frontend && npm run test:vouchers && npm run build
```

Test backend dùng MongoDB tạm độc lập và email giả, không gửi email thật hoặc thay đổi dữ liệu đang chạy.
