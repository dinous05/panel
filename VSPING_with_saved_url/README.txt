VSPING AUTO CHECKER v1.0.0

Chrome Extension Manifest V3. Đọc CSV UTF-8 từ URL Google Sheets, lấy URL ở cột B, kiểm tra trên tab www.vsping.com và ghi kết quả vào cột C. Tệp xuất là vsping_result.csv (CSV UTF-8 có BOM, hỗ trợ dấu phẩy/dấu ngoặc kép/Unicode).

Cài đặt: giải nén ZIP, vào chrome://extensions, bật Developer mode và Load unpacked. Đăng nhập vsping.com, mở popup, nhập URL CSV và START. Popup và panel trên trang có thể theo dõi tiến trình. CAPTCHA vẫn cần người dùng tự giải; extension chờ CAPTCHA biến mất.

Điều khiển: START tạo phiên; PAUSE dừng an toàn tại checkpoint; RESUME tiếp tục từ URL chưa hoàn thành; STOP dừng và giữ kết quả; RESET xóa trạng thái phiên; EXPORT CSV tải dữ liệu hiện có. Tiến trình và kết quả được lưu trong chrome.storage.local. Reload trang khi RUNNING sẽ khôi phục URL đang chờ kết quả; URL đã hoàn thành không chạy lại.

Trạng thái: RUNNING, PAUSED, STOPPED, COMPLETED. Timeout kiểm tra là 180 giây, sau đó ghi TIMEOUT và chuyển sang URL kế tiếp. Cột C được thêm/cập nhật, các cột dữ liệu khác được giữ nguyên.
