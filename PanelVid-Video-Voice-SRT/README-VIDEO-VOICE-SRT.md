# PanelVid — tạo video, voice và phụ đề từ panel

Đây là app thứ hai trong bộ hai ứng dụng. App này **không dò, tách hay xuất panel**; hãy dùng Panel Cutter trước để tạo ảnh panel rồi nhập kết quả vào PanelVid.

## Cách chạy

Giải nén ZIP và chạy `CHAY-PANELVID.bat`. Cần Node.js 22 trở lên và Python 3.11 cho một số giọng clone. Lần đầu BAT cần Internet để cài package, voice engine và model. Khi các thành phần đã được cài, các bước xử lý hình/video chạy trên máy. Giọng Microsoft Edge cần kết nối mạng; giọng clone Chatterbox/VieNeu chạy local sau khi cài.

## Luồng làm việc

1. Trong Panel Cutter, tách ảnh thành các panel rồi xuất folder chapter.
2. Trong PanelVid, bấm **Chọn thư mục panel** và chọn folder chapter; có thể chọn ZIP hoặc folder chứa nhiều chapter. Với Manga, cấu trúc khuyên dùng là `Chapter 001/Page 001/Panel 001.jpg`: ảnh trong mỗi folder trang phát lần lượt, rồi mới chuyển sang folder trang tiếp theo. Tên folder/file được sắp theo thứ tự tự nhiên. Folder phẳng vẫn tương thích, mỗi ảnh là một trang riêng.
3. Sắp xếp/đổi thời lượng cảnh và chỉnh bố cục video nếu cần.
4. Ở mục Giọng đọc, nạp **SRT** để dùng cue/mốc thời gian và phụ đề như trước; hoặc nạp **TXT theo panel** để căn voice từng ảnh mà không cần timestamp. Có thể thêm mốc trang `[TRANG n]` hoặc `[PAGE n]` trước lời từng trang. Chọn giọng rồi bấm **Tạo voice**.
5. Bấm **Tạo video MP4** hoặc đưa chap vào hàng đợi render.

PanelVid nhận SRT có sẵn để tạo voice và phụ đề; nội dung lời/SRT được soạn bên ngoài. TXT panel dùng một dòng hoặc một đoạn cách dòng cho mỗi panel. Khi có mốc trang, đặt dòng riêng `[TRANG 1]` trước các cue của trang 1, `[TRANG 2]` trước các cue của trang 2, v.v.; mốc trang không được đọc thành tiếng. Mỗi trang có mốc phải có đúng số cue bằng số ảnh panel thuộc folder trang đó. Nếu thiếu mốc của một trang, trước khi xuất app sẽ hỏi; chọn tiếp tục thì bỏ toàn bộ panel của trang thiếu mốc, chọn hủy thì dừng. TXT không có mốc vẫn ghép theo thứ tự panel như trước và phải có đúng một cue cho mỗi panel. Sau khi TTS hoàn tất, app đo thời lượng audio riêng của từng cue và đặt chính panel tương ứng bằng độ dài tiếng đọc đó. Đầu vào ảnh hỗ trợ JPG, PNG, WebP, BMP và ZIP ảnh. App cũng có thể tạo video không voice nếu không nạp SRT/TXT.
## Manhwa và Manga lai

Chọn Manhwa để cuộn dọc liên tục. Với Manga lai, đặt ngưỡng chiều cao panel trong Cài đặt: panel cao hơn ngưỡng sẽ cuộn riêng, panel ngắn hơn hiện dạng thẻ trên nền mờ và phóng nhẹ khi vào cảnh. Trong Manhwa, mỗi ảnh giữ tỷ lệ gốc theo độ rộng chung; mặc định là 100% khung hình, có thể chỉnh 40–100% trong Cài đặt video. Nếu dùng TXT panel, thời lượng mỗi cảnh khớp audio AI của đoạn tương ứng; các trường hợp khác vẫn theo chế độ thời lượng đã chọn.

Trong Manga/Manga lai, các lựa chọn In/Out (mờ, trượt bốn hướng, zoom, flash trắng) được áp dụng tại ranh giới folder trang. Manhwa tiếp tục cuộn thẳng, không dùng transition trang.

## Render nhiều chapter tự động
Trong mục **Hàng đợi render**, chọn **ZIP chapter** (một ZIP có các folder chap) hoặc **folder chapter** (folder gốc chứa các folder chap ảnh), rồi chọn folder chứa file **.TXT/.SRT**. App tự gom ảnh, sắp xếp chapter và subtitle theo tên tự nhiên (2 trước 10), ghép tên trùng trước rồi ghép phần còn lại theo thứ tự. SRT lệch số cue không yêu cầu xác nhận trước khi chạy; bảng xem trước vẫn cho phép sửa ghép thủ công nếu cần.

Chọn một giọng Edge AI chung cho batch (hoặc nhập Voice ID), chọn **Folder xuất** rồi bấm **Tạo & render batch**. Mỗi chapter tạo voice riêng và render thành một MP4 riêng theo cấu hình GPU/worker hiện tại. Queue chạy lần lượt các chap để tránh quá tải, đồng thời tạo voice chap kế tiếp khi chap hiện tại render. Bật **Tự nối MP4 sau khi render xong** nếu muốn FFmpeg nối các video batch theo thứ tự; file chap riêng vẫn được giữ. Nếu các MP4 cùng chuẩn, app nối stream-copy mà không encode video lại; khác chuẩn thì phải chuẩn hóa/encode bằng CPU. Có thể dừng, thử lại job lỗi và xem đường dẫn video ở danh sách hàng đợi.

## Cài đặt và mở app
Chạy `CHAY-PANELVID.bat` để cài dependency Node và Edge TTS cần cho tạo giọng AI thông thường rồi mở app. Launcher mặc định không cài engine clone dung lượng lớn; nếu cần tính năng clone, chạy riêng `CHAY-VOICE-CLONE.bat`. Edge TTS cần kết nối Internet khi tạo giọng.
