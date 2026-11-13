
## Batch render nhiều chapter từ ZIP/folder
- Thêm bộ nhập batch trong mục Hàng đợi: chọn ZIP nhiều folder chapter hoặc folder ảnh chapter, chọn folder TXT/SRT và folder xuất một lần.
- Tự nhóm ảnh theo folder chapter, ghép subtitle theo tên đã chuẩn hóa (Chap/Chapter/Ch và số 0 đầu); hiển thị bảng để kiểm tra và sửa ghép khi tên không khớp; một chapter + một subtitle tự ghép dù tên khác nhau. Cho phép chọn Edge voice/Voice ID chung cho toàn loạt.
- Kiểm tra parser SRT/TXT, số cue TXT phải khớp panel, tạo snapshot riêng cho từng chapter và lưu vào queue bền vững.
- Tạo video thành các MP4 riêng, xử lý tuần tự giữa chapter để tái dùng TTS/render queue hiện có; tránh ghi đè file đã tồn tại bằng hậu tố số.

- Launcher `CHAY-PANELVID.bat` chỉ cài Python/Edge TTS và app; không tự tải Chatterbox/VieNeu nhiều GB. Cài/chạy clone vẫn có trong `CHAY-VOICE-CLONE.bat` riêng.
