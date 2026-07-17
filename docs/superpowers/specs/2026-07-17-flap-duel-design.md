# FlapDuel — Game đấu kèo 1v1 trên Celo/MiniPay (Proof of Ship)

**Ngày:** 2026-07-17 · **Trạng thái:** Đã duyệt design, chờ review spec
**Tên làm việc:** FlapDuel (tên chính thức chốt sau, không chặn việc build)

## 1. Mục tiêu & bối cảnh

Mini app game cho MiniPay, tham gia chương trình **Celo Proof of Ship** (Season 2,
đến 30/6/2026 — trần thưởng lũy kế 2.000 USDT/dự án; nếu season đã kết thúc thì
áp dụng theo campaign đang mở trên talent.app).

Định vị: game hyper-casual **một chạm kiểu Flappy Bird** với cơ chế **đấu kèo 1v1
cược stablecoin** và **ghost race** (đua với replay mờ của đối thủ). Khác biệt với
catalog MiniPay hiện tại: mọi game đang có đều là chơi solo so leaderboard; chưa
có game PvP đặt cược. Câu chuyện marketing: "game Việt huyền thoại trở lại
on-chain".

**Tiêu chí thành công (theo thang chấm Proof of Ship):**
- Đủ 4 điều kiện cứng: contract trên Celo Mainnet, repo GitHub public, app live,
  đăng ký talent.app.
- Người dùng thật trả phí on-chain (mốc tối thiểu có ý nghĩa: 10 ví giao dịch).
- App chạy trọn luồng trên mobile/MiniPay, không dead link, không vỡ layout.
- Bundle JS < 2MB. Có hook `isMiniPay()` (điểm cộng).

**Ngoài phạm vi (YAGNI):** AI agent đối thủ (đã quyết định bỏ), giải đấu ngày
(tournament pot), tài khoản/đăng nhập ngoài ví, push notification, âm thanh phức
tạp, đa game mode.

## 2. Vòng lặp game & kinh tế

### Core loop (một chạm)
- Chim bay qua khe giữa các ống; chạm để vỗ cánh; va chạm là kết thúc lượt.
- Mỗi lượt < 60 giây, chết là chơi lại được ngay. Độ khó tăng dần theo điểm.
- Engine **tất định**: thế giới sinh từ `seed`; cùng seed + cùng chuỗi thời điểm
  chạm ⇒ cùng kết quả tuyệt đối (điều kiện tiên quyết cho ghost và chống gian lận).

### Chế độ chơi
1. **Luyện tập (free):** không giới hạn, không on-chain. Leaderboard điểm cao
   off-chain để giữ chân.
2. **Đấu kèo 1v1 (bất đồng bộ):**
   - Người tạo kèo chọn mức cược **0.1 / 0.5 / 1 USDm**, approve + nạp vào
     contract escrow, chơi 1 lượt với seed do backend cấp. Replay (chuỗi tap)
     được lưu; kèo lên danh sách "kèo mở".
   - Người nhận kèo cược cùng mức, chơi **cùng seed**, thấy **ghost của người
     tạo bay song song**. Điểm cao hơn thắng cả pot trừ **5% phí** về treasury.
   - Hòa điểm: hoàn cược cả hai (trừ trường hợp hai bên cùng 0 điểm — vẫn hoàn).
   - Kèo không ai nhận sau **24h**: người tạo tự rút lại tiền (hoàn 100%).
   - Nút **"Phục thù"** sau khi thua: tạo kèo mới gắn cờ mời đúng đối thủ cũ
     (đối thủ thấy kèo được ưu tiên hiển thị; người khác vẫn nhận được nếu quá
     1h không phản hồi).
3. **Cold start:** seed sẵn 5–10 kèo "nhà làm" từ lượt chơi thật của dev (ví dev,
   tiền thật, minh bạch là house ghost trong UI) để ngày đầu ai vào cũng có kèo.

### Đồng tiền & phí gas
- Cược bằng **USDm (cUSD)** — mainnet `0x765DE816845861e75A25fCA122bb6898B8B1282a`
  (18 decimals).
- Gas: ví MiniPay không có CELO ⇒ mọi hướng dẫn giao dịch dùng
  `feeCurrency` = USDm adapter (tra `FeeCurrencyDirectory`
  `0x15F344b9E6c3Cb6F0376A36A64928b13F62C6276` lúc implement; MiniPay tự xử lý
  phần lớn việc này qua provider inject).

## 3. Chống gian lận

- Client **không bao giờ gửi điểm số** — chỉ gửi `(duelId, seed, tapTimestamps[])`.
- Backend chạy lại đúng engine tất định (cùng mã nguồn engine, chạy trên Node)
  để tính điểm từ tap trace. Điểm client hiển thị chỉ là dự đoán cục bộ.
- Backend ký kết quả bằng **khóa oracle** (EIP-712: `duelId, winner, scoreA,
  scoreB`). Contract `settle()` chỉ chấp nhận chữ ký oracle.
- Giới hạn hợp lý trên trace: số tap/giây tối đa (chống bot spam siêu nhân),
  độ dài lượt tối đa. Vi phạm ⇒ lượt không hợp lệ, xử thua.
- Chấp nhận rủi ro còn lại (ghi nhận, không xử lý trong MVP): người chơi tự
  viết bot chơi giỏi. Với mức cược ≤ 1 USDm, chi phí tấn công > lợi ích.

## 4. Kiến trúc

```
MiniPay/Browser ──> Next.js (Vercel)
  │ Canvas game engine (deterministic, TS thuần)
  │ wagmi/viem + MiniPay injected provider
  ├─ API routes: cấp seed, nhận trace, verify + ký oracle, list kèo
  ├─ Postgres (Neon qua Vercel Marketplace): duels, replays, leaderboard free
  └─ DuelEscrow.sol (Celo Mainnet, Foundry)
       createDuel / acceptDuel / settle(sig) / cancelExpired
```

### Contract `DuelEscrow` (1 contract duy nhất)
- `createDuel(stake)` — transferFrom USDm vào escrow, emit `DuelCreated(id)`.
  Mức cược chỉ nhận 1 trong 3 tier (chống kèo rác).
- `acceptDuel(id)` — khóa người nhận + cược đối ứng; kèo hết hạn thì revert.
- `settle(id, winner, scoreA, scoreB, oracleSig)` — verify EIP-712, trả
  `2*stake*95%` cho winner, 5% về treasury; hòa thì hoàn cược cả hai.
  Ai gọi cũng được (thường là backend relayer hoặc winner tự claim).
- `cancelExpired(id)` — sau 24h chưa có người nhận, hoàn tiền người tạo.
- Biến quản trị tối thiểu: `oracle`, `treasury`, `owner` (đổi oracle khi lộ khóa).
  Không upgradeable, không pause phức tạp — giữ contract nhỏ, dễ audit tay.

### Data flow một kèo (happy path)
1. FE gọi `POST /api/duels` ⇒ backend sinh seed, lưu duel draft.
2. FE hướng dẫn approve USDm + `createDuel(stake)` ⇒ backend đối chiếu event,
   kèo chuyển trạng thái `open`.
3. Người tạo chơi ⇒ `POST /api/duels/:id/replay` (tap trace) ⇒ backend verify,
   lưu điểm A + trace làm ghost.
4. Người nhận `acceptDuel(id)` ⇒ chơi cùng seed với ghost A ⇒ nộp trace ⇒
   backend verify, tính winner, ký EIP-712, gọi `settle()`.
5. FE hiện kết quả (hộp thoại Win95) + nút Phục thù.

### Xử lý lỗi chính
- **Nộp tiền rồi nhưng không chơi/không nộp trace:** sau 1h kể từ accept mà bên
  nào không có trace hợp lệ ⇒ backend ký xử thua bên đó (điểm 0). Người tạo kèo
  không chơi ⇒ kèo không bao giờ `open`, rơi về `cancelExpired`.
- **Backend/oracle sập:** tiền không mất — kèo chưa settle vẫn nằm escrow;
  trường hợp xấu nhất người chơi chờ oracle sống lại; `cancelExpired` là lối
  thoát cho kèo chưa ai nhận. (Chấp nhận: kèo đã accept mà oracle chết vĩnh viễn
  thì kẹt — ghi chú nâng cấp sau nếu cần.)
- **Reorg/tx fail:** FE luôn đọc trạng thái từ backend (backend index event),
  hiển thị trạng thái pending rõ ràng bằng progress bar Win95.

## 5. UI/UX — ngôn ngữ Win95/98, xương mobile

- Nền tảng: `98.css` (vài chục KB) + tùy biến; pixel font; desktop teal.
- **Xương mobile-first:** một cột, tap target ≥ 44px, mọi nút chính trong tầm
  ngón cái; title bar/nút X chỉ là trang trí, không phải điều hướng chính.
- Ánh xạ màn hình:
  - Màn chính = "desktop" với icon: Chơi ngay, Kèo mở, Bảng vàng, Ví.
  - Danh sách kèo = cửa sổ File Explorer, mỗi kèo một dòng "file".
  - Thua kèo = hộp thoại lỗi ⚠️ "You lost 0.2 USDm — [Phục thù] [Đóng]".
  - Giao dịch pending = progress bar xanh từng khối + con trỏ đồng hồ cát.
  - Leaderboard = bảng kiểu Excel 97.
  - Game canvas: sạch, đóng khung cửa sổ có title bar; pixel art nhất quán.
- **Ngôn ngữ:** EN mặc định, toggle VI. Copywriting chăm chút (tiêu chí review).
- Hook `isMiniPay()`: trong MiniPay ẩn nút connect wallet ngoài, dùng provider
  inject; ngoài MiniPay vẫn chơi free + connect ví thường được.

## 6. Kiểm thử & nghiệm thu

- **Contract (Foundry):** create/accept/settle thắng-thua-hòa, sai chữ ký phải
  revert, cancelExpired đúng mốc thời gian, tier cược sai phải revert, fee về
  đúng treasury. Fuzz cơ bản trên stake/score.
- **Engine:** golden tests tất định — bộ (seed, trace) cố định ⇒ điểm cố định,
  chạy cả browser lẫn Node phải trùng; test giới hạn tap/giây.
- **E2E tay trước khi submit:** trọn luồng tạo kèo → nhận kèo → settle trên
  MiniPay site tester bằng 2 ví thật, mainnet, mức cược 0.1 USDm.
- **Bundle:** kiểm `next build` output < 2MB JS first-load.

## 7. Checklist Proof of Ship

- [ ] `DuelEscrow` deploy + verify trên Celo Mainnet (Celoscan)
- [ ] Repo GitHub public, commit đều trong sprint
- [ ] App live trên Vercel, chạy được trên MiniPay site tester
- [ ] Đăng ký talent.app, submit campaign tháng hiện tại, khai data sources
  (đường dẫn tới hook isMiniPay trong repo)
- [ ] Seed 5–10 kèo nhà làm trước khi công bố
- [ ] Demo video ngắn (nice-to-have cho review)
