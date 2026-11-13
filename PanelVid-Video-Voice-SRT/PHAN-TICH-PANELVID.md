# Phân chia chức năng hai ứng dụng

Bộ công cụ gồm hai app desktop riêng, được khởi chạy bằng file `.bat`:

1. **Panel Cutter Offline**: nhận ZIP/CBZ/RAR/CBR hoặc folder ảnh; cắt panel theo Manga, Manhwa hoặc Manhua; xuất ảnh panel ra folder. Manga giữ folder con theo từng trang; Manhwa/Manhua xuất một folder panel theo thứ tự dọc.
2. **PanelVid Offline**: chỉ nhận ảnh panel đã cắt (folder kết quả từ Panel Cutter, nhiều ảnh riêng hoặc ZIP ảnh). Mỗi ảnh panel thành một cảnh video. App giữ các công cụ sắp cảnh, chỉnh bố cục/thời lượng, nạp SRT, tạo voice, thêm phụ đề và xuất MP4.

## Ranh giới chức năng

PanelVid không có luồng tự động nhận diện panel, không ghép ảnh nguồn để tìm ranh giới panel, không có nút khoanh/tách panel và không hỏi người dùng cắt thủ công. Nếu nhập một trang truyện gốc thay vì folder từ Panel Cutter, ảnh đó được đưa vào video như một cảnh nguyên trang; hãy chạy nó qua Panel Cutter trước nếu muốn video theo từng panel.

PanelVid vẫn có crop bố cục ở mức cảnh để căn khung video. Crop này chỉ ảnh hưởng cách hiển thị cảnh trong video, không tạo ra ảnh panel mới hay thay đổi ảnh nguồn.

## SRT và voice

PanelVid nhận một file SRT có sẵn để tạo voice bằng giọng Edge hoặc giọng clone, đồng bộ thời lượng theo cue/mốc trang và có thể burn phụ đề vào MP4. Nội dung SRT được soạn bên ngoài. Giọng Microsoft Edge cần Internet; giọng clone chạy local sau khi cài engine/model.

## Chạy trên Windows

Giải nén gói từng app riêng, rồi chạy `CHAY-PANELCUTTER.bat` cho bước cắt hoặc `CHAY-PANELVID.bat` cho bước tạo video. Hai app cần Node.js 22 trở lên; PanelVid còn cần Python 3.11 cho các engine clone. Lần đầu cần Internet để cài dependencies/model.
