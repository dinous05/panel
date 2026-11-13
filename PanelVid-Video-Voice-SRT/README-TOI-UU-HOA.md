# Ghi chú tối ưu PanelVid

Đã sửa lỗi phạm vi biến khi dựng timeline: kết quả loudness được lưu riêng theo từng cue trước khi tạo filter âm thanh. Edge TTS chạy tối đa hai cue cùng lúc, bỏ delay cứng 2 giây, nhưng vẫn giữ retry/backoff và kiểm tra file đầu ra. Thời lượng và loudness mỗi cue được phân tích chung trong một lượt FFmpeg.

Render nay cho phép chọn tối đa 4 trang song song trong một chap (mặc định vẫn là 2). Với x264, số luồng encode mỗi tiến trình được chia theo số CPU logic để hạn chế tranh CPU. NVENC có thể tăng tốc, nhưng bốn tác vụ đồng thời vẫn có thể tranh tài nguyên GPU/RAM; nếu máy chậm hoặc thiếu bộ nhớ, giảm về 2 hoặc 3. Cấu hình mới có mục “4 (nhanh hơn, tốn tài nguyên)”. Queue vẫn render lần lượt từng chap và tạo voice chap kế tiếp trong lúc chap hiện tại render.

Bỏ `+faststart` ở bước mux cuối để tránh lượt di chuyển moov atom toàn file khiến tiến độ đứng lâu ở 99%. MP4 vẫn hợp lệ, nhưng không tối ưu cho phát trực tuyến khi file chưa tải xong. Batch mặc định sắp xếp chap, ảnh và TXT/SRT theo tên tự nhiên (ví dụ 2 trước 10).

Kiểm tra: `node --check` cho main/render, `npm test`, và `npm run build:renderer`.
