# Bảng xếp hạng chi tiêu theo quý dành cho admin

Trang **Admin → Voucher management → Xếp hạng theo quý** hiển thị 20 khách hàng có tổng chi tiêu hợp lệ cao nhất trong quý. Admin có thể chọn các quý trước để tham khảo khi tạo và gửi voucher. Customer không thấy bảng này và không có quyền gọi API xếp hạng.

Quý được tính theo giờ Việt Nam. Hai khách hàng bằng tổng chi tiêu có cùng hạng; thứ tự hiển thị khi bằng điểm theo tên tài khoản. API chỉ trả tên tài khoản, ID và tổng chi tiêu, không trả email. Dữ liệu dùng sổ chi tiêu của chương trình voucher từ thời điểm bật lần đầu. Hoàn tiền được đối soát sau đó có thể sửa lại thứ hạng lịch sử.

API `GET /api/admin/voucher-templates/leaderboard?quarter=YYYY-QN` chỉ dành cho admin. Quý sai định dạng, trước khi chương trình bắt đầu hoặc trong tương lai đều bị từ chối.
