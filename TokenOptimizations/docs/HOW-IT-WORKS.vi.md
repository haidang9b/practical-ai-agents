# tokenkit hoạt động như thế nào: cơ chế, nền tảng lý thuyết và cách triển khai

> English: [HOW-IT-WORKS.md](HOW-IT-WORKS.md)

Tài liệu này dành cho kỹ sư muốn biết **vì sao** tokenkit được xây dựng như hiện tại, **cơ chế** từng phần hoạt động ra sao, và mỗi ý tưởng nằm **ở đâu** trong mã nguồn. Đây là tài liệu đi sâu, bổ sung cho [GUIDE.md](GUIDE.md), vốn mô tả hành vi mà người dùng nhìn thấy. Nếu bạn chỉ muốn sử dụng công cụ, hãy đọc GUIDE trước.

Mọi nội dung ở đây đều lấy từ mã nguồn trong `src/` và `templates/`. Số dòng trong tài liệu tham chiếu đến các tệp như đang có trong kho này. Các con số đo lường được trích từ [COMPARE.md](COMPARE.md) và [README.md](../README.md), do tác giả dự án đo, không phải do tài liệu này đo lại.

**Mục lục**

1. [Mô hình chi phí](#1-mô-hình-chi-phí)
2. [Nguyên tắc thiết kế](#2-nguyên-tắc-thiết-kế)
3. [Kiến trúc](#3-kiến-trúc)
4. [Vòng đời hook: luồng thực thi từng bước](#4-vòng-đời-hook-luồng-thực-thi-từng-bước)
5. [Ước lượng số token](#5-ước-lượng-số-token)
6. [Bộ nén đầu ra](#6-bộ-nén-đầu-ra)
7. [Phân loại lệnh và guard](#7-phân-loại-lệnh-và-guard)
8. [Chạy và kiểm tra lệnh](#8-chạy-và-kiểm-tra-lệnh)
9. [Repo map](#9-repo-map)
10. [Gợi ý vị trí](#10-gợi-ý-vị-trí)
11. [TaskSpec](#11-taskspec)
12. [Kiểm toán ngân sách ngữ cảnh](#12-kiểm-toán-ngân-sách-ngữ-cảnh)
13. [Đo lường](#13-đo-lường)
14. [Cài đặt, nâng cấp và gỡ bỏ](#14-cài-đặt-nâng-cấp-và-gỡ-bỏ)
15. [Kiểm tra sức khỏe](#15-kiểm-tra-sức-khỏe)
16. [Một vết thực thi: "run the tests"](#16-một-vết-thực-thi-run-the-tests)
17. [Giới hạn, giả định và các điểm bất thường đã biết](#17-giới-hạn-giả-định-và-các-điểm-bất-thường-đã-biết)
18. [Bản đồ mã nguồn](#18-bản-đồ-mã-nguồn)
19. [Thuật ngữ](#19-thuật-ngữ)

---

## 1. Mô hình chi phí

### 1.1 Một bước của agent

Một lượt agent là một vòng lặp. Ở mỗi **bước** `t` (một lần gọi mô hình), harness gửi toàn bộ hội thoại cho mô hình, và mô hình trả về hoặc văn bản hoặc một lệnh gọi công cụ. Công cụ chạy, kết quả được nối vào hội thoại, và vòng lặp lặp lại. Ký hiệu:

| Ký hiệu | Ý nghĩa |
|---|---|
| `T` | số lần gọi mô hình (bước) trong một lượt |
| `c_t` | kích thước ngữ cảnh, tính bằng token đầu vào, gửi ở bước `t` |
| `a_t` | số token đầu ra mô hình sinh ra ở bước `t` |
| `p` | giá một token đầu vào chưa được cache |
| `p_c` | giá một token đầu vào đã được cache (khoảng `0.1 p`, theo README) |
| `o` | giá một token đầu ra (khoảng 5–8 lần `p`, theo README) |

Chi phí của một lượt là

```
chi phí ≈ Σ_t [ (c_t − phần cache) · p  +  phần cache · p_c  +  a_t · o ]
```

Gần như toàn bộ `c_t` đã được cache từ bước trước, nên phần đầu vào do mức giá cache chi phối. Đầu ra đắt nhưng ngắn. Vì vậy chi phí thực tế chủ yếu phụ thuộc vào **số bước** nhân với **kích thước ngữ cảnh ở mỗi bước**.

### 1.2 Chi phí trọn đời của một token

Xét một token được đưa vào ngữ cảnh ở bước `k`, ví dụ 10.000 token của một log test mà agent vừa đọc. Nó có mặt trong mọi đầu vào `c_t` với `t > k`. Vì vậy tổng chi phí đầu vào của nó trong cả lượt là

```
trọn đời(token đưa vào ở k) ≈ p  +  (T − k) · p_c
                            = p · (1 + 0.1 · (T − k))     với p_c ≈ 0.1 p
```

Lần gửi đầu tiên bị tính theo giá đầu vào đầy đủ, và mỗi bước sau đó bị tính theo giá đã cache. Đây là cốt lõi của kinh tế học mà tokenkit dựa vào: **một đầu ra công cụ lớn sẽ tốn nhiều hơn khi nó xuất hiện càng sớm và càng có nhiều bước theo sau.**

Mô hình này là một cách đơn giản hóa. Nó giả định lần gửi đầu tiên tốn `p` và mọi lần gửi sau đều cache-hit với giá `0.1 p`. Phí ghi cache và tỷ lệ cache-miss thực tế khác nhau theo nhà cung cấp, và Copilot không mô tả chi tiết các con số này, nên hãy coi hệ số nhân là một ước lượng.

### 1.3 Vì sao phiên dài tăng theo bậc hai

Nếu mỗi bước thêm `g` token mới và ngữ cảnh bắt đầu ở `c_0`, thì

```
c_t = c_0 + g · t
Σ_{t=1..T} c_t = T · c_0 + g · T(T+1)/2
```

Tổng lượng ngữ cảnh được xử lý tăng theo `T²`. Tăng gấp đôi số bước làm chi phí tăng hơn gấp đôi. Ví dụ với `c_0 = 0` và `g = 1000` token mỗi bước:

| Số bước `T` | Σ c_t (token-bước) |
|---|---|
| 10 | 55.000 |
| 20 | 210.000 (chi phí gấp 3,8 lần khi số bước gấp đôi) |

Hai hệ quả này định hình thiết kế của tokenkit:

- **Giảm số bước** cũng quan trọng như giảm kích thước đầu ra. Đó là lý do `tk verify` chạy typecheck, lint và test trong một lần gọi, và vì sao chỉ dẫn yêu cầu "kiểm tra một lần, ở cuối".
- **Giảm phần thêm vào** quan trọng vì nó bị nhân với mọi bước còn lại. Đó là lý do nén được áp dụng cho đầu ra công cụ, vì đây là phần thêm vào lớn nhất.

### 1.4 Lợi ích của một lần nén

Nếu một kết quả công cụ `r` token được thay bằng một bản `r'` token ở bước `k`, phần tiết kiệm là

```
tiết kiệm = (r − r') · p · (1 + 0.1 · (T − k))
```

Ví dụ minh họa, dùng mô hình trên với 20 bước còn lại sau khi kết quả đến (`T − k = 20`), nên hệ số nhân là `1 + 0.1 × 20 = 3`:

- Một log test 10.000 token được nén còn 300 token.
- Tiết kiệm = `(10.000 − 300) × 3 = 29.100` đơn vị tương đương token đầu vào.

Nếu cùng log đó được nén ở bước `T` (bước cuối), nó chỉ tiết kiệm `(10.000 − 300) × 1`. Đầu ra lớn được cắt càng sớm thì càng có giá trị. Đây cũng là lý do tokenkit nén đầu ra **ngay khi nó được tạo** (trong hook), không chờ.

### 1.5 Token đi đâu

[COMPARE.md](COMPARE.md) đo thành phần prompt của một yêu cầu VS Code thực tế, khoảng 27.000 token. Phần cố định được trả ở mọi bước, nên bị nhân với `T`:

| Thành phần của mọi yêu cầu | Tỷ trọng (đo được, không có tokenkit) | tokenkit có thay đổi được không? |
|---|---|---|
| Chỉ dẫn hệ thống của Copilot | 38% | Không (tokenkit thêm khoảng 324 token) |
| Định nghĩa công cụ (schema của mọi công cụ đang bật) | 50% | Có, qua agent `lean`, vốn giới hạn công cụ |
| Tin nhắn của người dùng | 4% | Ít (TaskSpec, câu trả lời ngắn) |
| Kết quả công cụ | 8% | Có: nén, chặn đọc, lệnh có giới hạn |

Khoảng 24.000 token là chi phí cố định trên mỗi lần gọi. Vì vậy tokenkit tách riêng hai việc: **giảm chi phí cố định** (chỉ dẫn, danh sách công cụ, mô tả skill), và **giảm phần tăng dần** (kết quả công cụ và số bước).

---

## 2. Nguyên tắc thiết kế

Đây là những ý tưởng nằm sau mã nguồn. Mỗi nguyên tắc giải thích một lựa chọn thiết kế cụ thể.

### 2.1 Mất mát trong ngữ cảnh, không mất mát trên đĩa

Bộ nén loại bỏ dòng, tức là mất mát. Nhưng mọi đầu ra đã nén cũng được ghi đầy đủ vào `.tokenkit/logs/` (`tool-*.log`, `run-*.log`, `last.log`), và mô hình được cho biết tệp nào cần grep. Vì vậy agent luôn có thể lấy lại chi tiết khi cần. Nguyên tắc là: **ngữ cảnh nhận tối thiểu cần thiết để hỗ trợ quyết định tiếp theo, còn đĩa giữ tất cả.**

### 2.2 Phần lớn log test là phần nền ít thông tin

Một lần chạy test thất bại thường có vài dòng làm thay đổi hành động tiếp theo của agent (assertion thất bại, giá trị kỳ vọng và thực tế, tệp và dòng gây lỗi, dòng tổng kết), và nhiều dòng không làm thay đổi gì (test đã pass, thanh tiến trình, tải phụ thuộc, khung stack của thư viện). Bộ nén là một bộ lọc xấp xỉ câu hỏi "xóa dòng này có làm thay đổi hành động tiếp theo của agent không?" và trả lời bằng các luật: mẫu nhiễu, mẫu test pass, mẫu khung thư viện, và "giữ dòng lỗi cùng các dòng lân cận".

### 2.3 Tìm trước, đọc sau

Đọc cả tệp để tìm một hàm tốn đúng kích thước của tệp đó, ở mọi bước. Tra một chỉ mục trước tốn vài dòng, rồi mới đọc một đoạn có giới hạn. tokenkit xây dựng một chỉ mục dễ grep (repo map) và một bộ so khớp mang tính xác định (gợi ý vị trí) để agent có thể **định vị, rồi chỉ đọc một đoạn**. Đây là mẫu truy hồi thông tin kinh điển: chỉ mục trả lời câu hỏi "ở đâu" với giá rẻ, còn phần "nội dung" đắt chỉ được lấy khi cần.

### 2.4 Thu nhỏ chi phí cố định

Mọi byte chỉ dẫn luôn bật, mọi schema công cụ và mọi mô tả skill đều bị trả ở mọi bước. Vì vậy tokenkit giữ chỉ dẫn luôn bật ở khoảng 324 token (ngân sách 1200), giữ mô tả skill ngắn, cung cấp agent `lean` với danh sách công cụ tối giản, và cung cấp bộ kiểm tra ngân sách làm CI thất bại khi ngữ cảnh luôn bật vượt quá giới hạn.

### 2.5 Giữ phần đầu prompt ổn định

Nhà cung cấp cache **phần đầu** của prompt. Bất cứ thứ gì thay đổi ở đầu prompt sẽ làm mất cache của mọi phần phía sau. Vì vậy:

- Hook `sessionStart` **không đưa gì** vào ngữ cảnh. Nó chỉ làm mới một tệp trên đĩa.
- Hook `userPromptSubmitted` chỉ gắn gợi ý vào tin nhắn của người dùng cho lượt đó.
- Kiểm toán ngân sách cảnh báo rằng bật/tắt công cụ MCP giữa phiên làm hỏng cache.

### 2.6 Ưu tiên độ chính xác hơn độ phủ, xác định và chạy offline

Gợi ý vị trí chỉ hữu ích khi nó thường đúng. Một gợi ý sai khiến agent đi nhầm chỗ và tốn kém hơn cả việc không có gợi ý. Vì vậy bộ so khớp được chỉnh để **biết dừng lại**: khi không có gì khớp đủ tin cậy, hoặc khi một prompt mơ hồ khớp với quá nhiều thứ, nó không in gì. Nó cũng **xác định và chạy offline**: không gọi mô hình, không dùng dịch vụ embedding, không cần mạng. Cùng prompt trên cùng repo luôn cho cùng gợi ý, nên có thể kiểm thử (`tk locate --why`).

### 2.7 Fail open và không bao giờ tự duyệt quyền

Một hook bị lỗi không được chặn agent, nên mọi hook đều bọc công việc của mình và thoát với mã 0 (`runHook`, `hookio.mjs:88`). Và guard không bao giờ cấp quyền. Nó chỉ có thể từ chối, hoặc viết lại lệnh mà không đưa ra quyết định cấp quyền, nên luồng duyệt bình thường của người dùng vẫn áp dụng cho lệnh đã viết lại.

---

## 3. Kiến trúc

### 3.1 Ba tầng

```
┌──────────────────────────────────────────────────────────────────────┐
│ Tầng A: chỉ dẫn (mô hình đọc)                                         │
│   .github/copilot-instructions.md  (luôn bật, ~324 token)             │
│   .github/skills/*/SKILL.md        (tên+mô tả luôn bật;               │
│                                     nội dung chỉ nạp khi liên quan)   │
│   .github/agents/lean.agent.md     (danh sách công cụ hạn chế)        │
│   .github/prompts/*.prompt.md      (/q /handoff /spec /audit)         │
├──────────────────────────────────────────────────────────────────────┤
│ Tầng B: thực thi (harness chạy, theo sự kiện)                         │
│   .github/hooks/tokenkit.json → .tokenkit/hooks/*.mjs                 │
│     sessionStart · userPromptSubmitted · preToolUse · postToolUse     │
├──────────────────────────────────────────────────────────────────────┤
│ Tầng C: CLI tk (mô hình, hook hoặc bạn gọi)                           │
│   .tokenkit/tk.mjs → lib/: compress, run, verify, repomap, locate,    │
│                             spec, budget, report, usage, doctor       │
└──────────────────────────────────────────────────────────────────────┘
```

Tầng A yêu cầu mô hình hành xử tốt. Tầng B thực thi những gì có thể thực thi tự động. Tầng C là bộ công cụ mà cả A và B đều gọi. Mỗi tầng hoạt động được mà không cần các tầng khác: nếu tổ chức tắt hook, chỉ dẫn và CLI vẫn chạy. Đó là tính chất "suy giảm có kiểm soát" (degrades gracefully) mà README nêu.

### 3.2 Bố cục kho và việc sao chép vào repo

```
src/                       runtime (được sao chép vào .tokenkit/ của mỗi repo)
  tk.mjs                   bộ điều phối CLI (argv → lệnh)
  hooks/                   guard.mjs · post.mjs · prompt.mjs · session.mjs
  lib/                     compress · run · verify · repomap · locate · spec ·
                           rules · budget · report · usage · doctor · install ·
                           hookio · tokens · config
templates/                 tệp được cài vào repo đích (.github/…, .vscode/…)
test/                      bộ kiểm thử node --test
docs/                      tài liệu cho người đọc
```

`install` sao chép `src/` vào `<repo>/.tokenkit/`. Bản sao này được **vendor hóa** (vendored): nó được commit vào repo đích, nên đồng đội và cloud agent lấy cùng một runtime từ git, không cần bước cài đặt riêng. Hook tham chiếu bản sao này bằng đường dẫn tương đối (`./.tokenkit/hooks/guard.mjs`), nên chúng chạy bằng phiên bản của chính repo, không phải phiên bản bạn đã cài từ đó.

Runtime tự xác định vị trí của mình bằng `KIT_DIR = dirname(fileURLToPath(import.meta.url)) / ..` (`config.mjs`). Nhờ vậy cùng một mã chạy được cả trong bản nguồn lẫn bên trong `.tokenkit/`.

### 3.3 Hai dạng payload, một giao diện

Copilot gửi payload của hook theo hai dạng tùy harness:

| Trường | camelCase (Copilot CLI, cloud agent, một số đường VS Code) | snake_case (VS Code, kiểu Claude) |
|---|---|---|
| tên công cụ | `toolName` | `tool_name` |
| đối số | `toolArgs` (object hoặc chuỗi JSON) | `tool_input` |
| kết quả | `toolResult: { resultType, textResultForLlm }` | `tool_response` |

`normalize()` (`hookio.mjs:19`) chuyển một trong hai dạng về cùng một cấu trúc `{ camel, tool, args, argsWereString, output, cwd }`. Nó cũng phân tích `toolArgs` nếu đến dưới dạng chuỗi JSON. Các hàm phát đầu ra trả lời theo dạng mà harness mong đợi: `emitDeny` ghi cả `permissionDecision` lẫn `hookSpecificOutput.permissionDecision`, và `emitRewrite` ghi cả `modifiedArgs` (CLI) lẫn `hookSpecificOutput.updatedInput` (VS Code). Việc giữ kiến thức về dạng payload trong một tệp là một thiết kế **adapter** có chủ đích, để phần còn lại của mã không cần biết nó đang chạy trong harness nào.

---

## 4. Vòng đời hook: luồng thực thi từng bước

Tệp đăng ký hook (`templates/.github/hooks/tokenkit.json`) khai báo bốn sự kiện. Mỗi sự kiện chạy một script Node nhỏ qua `node -e "import('./.tokenkit/hooks/X.mjs').catch(()=>0)"`. Dòng lệnh này chạy được trong cmd, PowerShell, bash và sh, và thoát im lặng với mã 0 nếu thiếu runtime (fail open).

Mọi hook đều theo cùng một khung, `runHook` (`hookio.mjs:88`):

1. Đọc toàn bộ stdin và phân tích nó như JSON (`readPayload`).
2. Chạy logic của hook trong `try`. Mọi ngoại lệ được ghi vào `.tokenkit/logs/errors.jsonl`.
3. Đặt `process.exitCode = 0`. Dùng `exitCode` chứ không dùng `exit()` vì stdout có thể vẫn đang được ghi vào pipe.

### 4.1 `sessionStart` (`hooks/session.mjs`)

1. Gọi `mapIsStale(root, mapFile)` (`repomap.mjs:242`).
2. Nếu map đã cũ, gọi `writeMap` (tăng dần: chỉ đọc lại các tệp đã thay đổi, xem mục 9.4) và ghi lý do vào `session.jsonl`.
3. Không in gì. Hook này tồn tại để giữ map luôn mới, không phải để thêm ngữ cảnh.

### 4.2 `userPromptSubmitted` (`hooks/prompt.mjs`)

1. Nếu prompt ngắn hơn 8 ký tự, hoặc `prompt.hints` là `off`, dừng.
2. Phân tích prompt như TaskSpec (`parseSpec`). Nếu có động từ và ít nhất một phạm vi hoặc cờ, mở rộng nó và phát ra như ngữ cảnh, rồi dừng.
3. Nếu không, kiểm tra độ cũ của map và làm mới khi cần. (Tệp thường xuất hiện trong lúc phiên diễn ra, và agent có thể vừa tạo chúng.)
4. Gọi `locate(prompt, root, …)`. Nếu không có gợi ý, ghi `kind: none` vào log và dừng.
5. Phát các gợi ý như `additionalContext`. VS Code nối đoạn văn bản này vào tin nhắn của người dùng trước bước đầu tiên của agent.

### 4.3 `preToolUse` (`hooks/guard.mjs`)

Guard chạy trước mọi lệnh gọi công cụ. Với một **công cụ shell**, nó áp dụng các luật theo thứ tự cố định, luật khớp đầu tiên thắng:

1. Lệnh chạy nền (`isBackground`, hoặc `mode` là async/detached) không bao giờ bị can thiệp.
2. Lệnh **không giới hạn** (`git log`, liệt kê đệ quy, `docker logs` không giới hạn, v.v.) bị từ chối kèm một lựa chọn có giới hạn. Với các trường hợp mềm như `git diff`, hook trước tiên đo kích thước diff thật bằng `git diff --shortstat`, và chỉ chặn nếu thay đổi vượt quá 400 dòng.
3. **Đọc** (`cat`, `Get-Content`, `head`, `tail`, …) các đường dẫn bị chặn (lockfile, tệp sinh ra, tệp nhị phân) bị từ chối. Đọc cả tệp lớn hơn `maxReadKB` (48 KB) bị từ chối, trừ khi có khoảng dòng (`head`/`tail`/`-TotalCount`).
4. **Wrapper giả mạo**: một lệnh `tk … --b64` có payload không khớp với chú thích, hoặc không phân loại thành lệnh build/test, bị từ chối.
5. Lệnh **verbose** (test, build, cài đặt, lint, typecheck) được viết lại để chạy qua `tk run` (mặc định `auto` → `rewrite`). Ở chế độ `deny`, chúng bị chặn kèm đúng lệnh để chạy lại. Việc viết lại dùng `emitRewrite`, vốn không gửi quyết định cấp quyền, nên người dùng vẫn duyệt lệnh đã viết lại.

Với một **công cụ đọc** (trình xem tệp của harness), hook từ chối các đường dẫn bị chặn, và từ chối đọc cả tệp vượt giới hạn kích thước mà không có khoảng dòng.

### 4.4 `postToolUse` (`hooks/post.mjs`)

1. Ước lượng số token của đầu ra. Ghi `{tool, target, tokens}` vào `tools.jsonl`. Dữ liệu này phục vụ `tk report`.
2. Phát hiện điều kiện dự phòng. Nếu đây là VS Code (`!camel`), guard đang ở chế độ `rewrite`, lệnh là verbose, và đầu ra thiếu tiêu đề `[tk]`, thì VS Code đã bỏ qua việc viết lại. Ghi `localRewriteIgnored` vào `state.json`. Lần gọi guard tiếp theo chuyển sang `deny`.
3. Quyết định tính đủ điều kiện. Chỉ **dạng CLI** mới có thể thay thế đầu ra, và chỉ khi công cụ thành công, đầu ra lớn hơn `post.minTokens` (1500), công cụ không phải là đọc tệp hay sửa tệp, và lệnh không phải là chính `tk`.
4. Nén: đầu ra shell qua `compress` (mã thoát được phân tích từ văn bản), các đầu ra khác qua `headTail` (giữ 60 dòng đầu và 15 dòng cuối).
5. Chỉ chấp nhận việc nén nếu nó giữ lại ít hơn 80% số token (`kept < tokens × 0.8`). Nếu không, phần tiết kiệm không đáng để thay đổi, và bản gốc được giữ lại.
6. Lưu bản gốc đầy đủ vào `tool-<timestamp>.log` và trả về `modifiedResult` với tiêu đề `[tk] output compressed …`.

### 4.5 Khác biệt giữa các harness

| Khả năng | VS Code (Copilot Chat) | Copilot CLI / cloud agent |
|---|---|---|
| preToolUse có thể viết lại lệnh (`updatedInput` / `modifiedArgs`) | Có | Có |
| postToolUse có thể thay thế đầu ra (`modifiedResult`) | **Không**: chỉ ghi log hoặc thêm ghi chú | Có |
| Dạng payload của hook | snake_case hoặc camelCase | camelCase |
| Gợi ý prompt (`additionalContext`) | Có | Bị bỏ qua |

Vì VS Code không thể thay thế đầu ra sau khi lệnh chạy, đường đi trên VS Code phụ thuộc vào **guard** để viết lại lệnh *trước khi* nó chạy. Đường đi của CLI có thể nén cả sau khi chạy. Sự khác biệt này là lý do bộ nén đầu ra được gọi từ hai nơi.

---

## 5. Ước lượng số token

`estimateTokens` (`lib/tokens.mjs:4`) cho một ước lượng không phụ thuộc thư viện ngoài. Nó tách văn bản thành các đoạn bằng một biểu thức chính quy:

```
/[A-Za-z]+|\d+|\n[ \t]*|[^\sA-Za-z\d]+/g
```

Mỗi đoạn được tính theo lớp ký tự đầu tiên của nó:

| Đoạn | Ước lượng | Lý do |
|---|---|---|
| xuống dòng cộng thụt lề | 1 | bộ tách BPE thường gộp chúng thành một token |
| chữ số, độ dài `L` | `⌈L / 3⌉` | số được tách thành các mảnh ngắn |
| chữ cái, độ dài `L` | `⌈L / 6⌉` | một từ thường là một đến hai token con |
| ký hiệu và dấu câu, độ dài `L` | `⌈L / 2⌉` | toán tử và dấu câu thường gộp thành token ngắn |
| khoảng trắng giữa các đoạn | 0 | được gộp vào token bên cạnh |

Vậy `ước lượng(văn bản) = Σ_đoạn giá(đoạn)`. Chú thích trong mã nói rằng cách này bám sát `o200k`/`cl100k` trong khoảng ±20% với văn xuôi và mã. Bộ ước lượng là **công cụ ngân sách**, không phải công cụ tính tiền. Nó được dùng để quyết định một lần nén có đáng làm không, và để báo cáo phần tiết kiệm. Nó không bao giờ quyết định mô hình thấy gì, ngoại trừ qua các ngưỡng ở trên. Số đếm chính xác chỉ đến từ log của chính VS Code (xem [mục 13](#13-đo-lường)).

`fmtTokens` (`tokens.mjs:17`) định dạng số cho người đọc: `1.2k`, `15k`, `2.3M`.

---

## 6. Bộ nén đầu ra

`compress(raw, opts)` (`lib/compress.mjs:72`) biến đầu ra của một lệnh thành một bản ngắn hơn, giữ lại những gì agent cần để hành động. Nó là một đường ống gồm sáu pha.

### 6.1 Pha 1: chuẩn hóa

- Bỏ các chuỗi escape ANSI (màu, di chuyển con trỏ).
- Đổi `\r\n` thành `\n`. Với dòng có `\r` đứng riêng (thanh tiến trình tự ghi đè), giữ đoạn cuối cùng (trạng thái cuối), cùng mọi đoạn trước đó là lỗi. Nếu không, `error: EADDRINUSE …\r building... 40%` sẽ mất lỗi vào dòng tiến trình.
- Bỏ khoảng trắng cuối dòng và các dòng trống ở cuối.

### 6.2 Pha 2: phân loại từng dòng

Mỗi dòng nhận đúng một kết quả, kiểm tra theo thứ tự sau:

| Thứ tự | Kiểm tra | Kết quả | Được đếm trong |
|---|---|---|---|
| 1 | `LIB_FRAME` (khung stack từ `node_modules`, `node:internal`, site-packages của JVM/.NET/Python, std của Rust, runtime của Go) | Gộp thành một dấu `… N library frame line(s)` | `frames` |
| 2 | `NOISE` (thanh tiến trình, `npm warn`, `Downloading …`, `Compiling … v1.2.3`, siêu dữ liệu TAP, và mọi regex do người dùng thêm) | Bỏ | `noise` |
| 3 | `PASS` (`✓`, `PASS`, `ok 12 -`, `--- PASS:`, `test x ... ok`) **và dòng không chứa `fail` hoặc `error`** | Bỏ | `passed` |
| 4 | dòng lỗi có vị trí mã nguồn (`ERROR` và `LOCATION`) đã xuất hiện trước đó | Bỏ (chỉ hiện một lần) | `repeats` |
| 5 | mọi dòng còn lại | Giữ | `warnings` (các dòng khác nhau) nếu khớp `WARN` |

Luật 4 dành cho MSBuild, vốn in mọi lỗi trong lúc build rồi in lại trong phần tổng kết. Bỏ bản thứ hai giúp dành ngân sách cho các lỗi khác. Chỉ những dòng có vị trí `file:line` mới được xử lý như vậy, nên các dòng mẫu như `Error Message:` trong mỗi test .NET thất bại không bị bỏ.

Ba chi tiết quan trọng:

- Luật `PASS` có một ngoại lệ. Dòng như `✓ handles error paths` chứa `error`, nên được giữ. Việc giấu một dòng có thể nói "failed" là một sai lầm nguy hiểm.
- Traceback của Python in một dòng mã sau mỗi dòng `File "…"`. Khi `LIB_FRAME` khớp một dòng `File` bên trong thư viện, dòng thụt lề kế tiếp (mã nguồn của khung đó) cũng được gộp (`skipPyCode`).
- `ERROR` (`compress.mjs:49`) nhận ra nhiều hơn chữ "error". Nó còn khớp `fail`, `failing`, `exception`, `panic`, `traceback`, `assert…`, `expected`/`received`, tên lớp ngoại lệ (`ValueError:`, `System.InvalidOperationException:`), `aborted`, `crashed`, `timed out`, `unhandled`, `killed`, `out of memory`, `stack overflow`, mã lỗi của Node (`EADDRINUSE`, `ENOENT`, …), nửa `Actual:` và `But was:` của assertion xUnit/NUnit, và các dấu như `✗`, `●` và `> 12 |`.

Các dòng giữ lại giống hệt nhau và liền nhau được gộp kèm số lần lặp: `line  (×8)`.

### 6.3 Pha 3: gộp các chuỗi lặp

Các dòng không phải lỗi, liền nhau, được nhóm theo **hình dạng** (shape):

```
shape(s) = s với các literal hex và chuỗi chữ số được thay bằng "0",
           và nội dung trong dấu nháy được thay bằng cặp nháy rỗng
```

Ví dụ, `Copying file 17 of 200` và `Copying file 18 of 200` đều có hình dạng `Copying file 0 of 0`. Một chuỗi từ năm dòng trở lên cùng hình dạng giữ lại hai dòng đầu, một dấu `… +N similar line(s)`, và dòng cuối. Dòng cuối được giữ vì nó thường cho thấy trạng thái cuối của chuỗi.

Dòng lỗi **không bao giờ** bị gộp. Mỗi lỗi có thể trỏ đến một tệp hoặc một nguyên nhân khác nhau, nên gộp chúng sẽ phá hủy thông tin.

### 6.4 Pha 4: chọn những gì giữ lại

Gọi `rows` là danh sách sau khi gộp, và `cap` là giới hạn số dòng:

- Khi **thất bại** (`exitCode ≠ 0`): `head = 6`, `tail = 20`, `cap = maxLines = 80`.
- Khi **thành công**: `head = 0`, `tail = successTail = 8`, `cap = 2 × successTail = 16`.

Nếu `rows.length ≤ cap`, giữ tất cả. Nếu không, có hai ngân sách. Dòng lỗi và vị trí của chúng có ngân sách riêng, `maxErrorLines` (150; khi thành công là `successTail`). Phần đầu, phần cuối và ngữ cảnh dùng chung giới hạn dòng. Vì vậy ngữ cảnh không bao giờ đẩy một lỗi ra ngoài.

1. Giữ `head` dòng đầu và `tail` dòng cuối.
2. **Lỗi và vị trí của chúng.** Với mỗi dòng lỗi, theo thứ tự, giữ dòng đó cùng tối đa 3 dòng `LOCATION` ở mỗi phía: trong phạm vi 8 dòng, và không vượt qua một dòng lỗi khác. `LOCATION` (`compress.mjs:60`) khớp một khung stack hoặc con trỏ của trình biên dịch tới một tệp và dòng: `in X.cs:line 42`, `(src/a.test.tsx:11:21)`, `File "/app/x.py", line 4`, `Foo.java:12`, `--> src/main.rs:4:18`, `x.go:14:`. Đây là thứ giữ lại khung stack của một test .NET thất bại, vốn nằm sau `Actual: 81` 3 dòng, ngoài mọi cửa sổ ±2. Nó cũng giữ các dòng `File "…"` gần nhất trước một ngoại lệ Python. Khung thư viện không bao giờ tới bước này; pha 2 đã gộp chúng.
3. **Gộp lỗi lặp lại.** Một lỗi mà nội dung, sau khi bỏ vị trí, đã xuất hiện `FOLD_AFTER` (3) lần thì không hiện nữa. Nó được đếm theo từng thông báo, kèm số tệp. Đây là trường hợp "đổi tên một kiểu, 400 tệp báo CS0246". Nếu không gộp, 150 bản sao của một thông báo sẽ dùng hết ngân sách, và một lỗi *khác* in sau đó sẽ bị cắt.
4. Nếu ngân sách lỗi hết, các dòng lỗi còn lại được đếm (`droppedErrorLines`). Ghi chú nêu mã lỗi của chúng và số tệp chứa chúng.
5. **Ngữ cảnh.** Với mỗi lỗi được giữ, theo thứ tự, thêm một cửa sổ `±context` dòng (`context = 2`), trong khi giới hạn dòng còn cho phép. Các lỗi đầu tiên được thêm ngữ cảnh trước, vì chúng thường là nguyên nhân gốc, còn các lỗi sau thường là hệ quả dây chuyền.

Việc chọn là tham lam, không tối ưu, nhưng có độ phức tạp O(n) và có thể dự đoán được.

### 6.5 Pha 5: kết xuất với dấu khoảng trống

Các dòng được giữ được xuất theo thứ tự. Mỗi khoảng trống được thay bằng `… [N line(s) omitted]`, để agent thấy rằng có nội dung đã bị bỏ và biết khoảng bao nhiêu. Đầu ra cuối có thể dài hơn `cap` một chút vì các dòng đánh dấu này. Chúng không được tính vào `cap`.

### 6.6 Pha 6: báo cáo những gì đã bị loại

`notes` tóm tắt phần bị loại, để agent biết nó đã không thấy gì. Bên gọi in chúng dưới dạng `[tk] …`. Chúng gồm:

- số dòng test pass đã ẩn, số dòng nhiễu đã ẩn, số khung thư viện đã gộp;
- số dòng lỗi lặp lại chỉ hiện một lần;
- số cảnh báo còn trong log, kèm các mã phổ biến nhất (`60 warning line(s) in full log (CS8618 ×60)`);
- các lỗi đã gộp, theo từng thông báo: `same error at 1478 more location(s) in 225 file(s): "error CS0246: The type or namespace name 'OrderDto' could not be found"`;
- các lỗi vượt ngân sách, kèm mã và số tệp: `24 more error line(s) not shown (TS2304 ×24) in 12 file(s); grep the log`.

Tiêu đề `[tk]` ghi tên log riêng của lần chạy, `.tokenkit/logs/run-<timestamp>.log`. `last.log` vẫn được ghi, nhưng lần chạy kế tiếp sẽ ghi đè nó, trong khi agent có thể grep một lỗi sau vài lệnh nữa.

### 6.7 Một ví dụ thực tế

Đầu vào: 200 dòng `Copying file N of 200`, rồi một test thất bại, một assertion, một dòng stack, một dòng tổng kết, và 50 dòng test pass. Chạy với `exitCode = 1`:

```text
Copying file 0 of 200
Copying file 1 of 200
  … +197 similar line(s)
Copying file 199 of 200
FAIL test/a.test.js
AssertionError: expected 3 received 4
    at Object.<anonymous> (test/a.test.js:12:5)
Tests: 1 failed, 50 passed
```

Ghi chú: `50 passing-test line(s) hidden`. Kích thước: vào 254 dòng và khoảng 1.747 token ước lượng; ra 8 dòng và khoảng 78 token. Lỗi, thông báo lỗi, vị trí và dòng tổng kết đều còn nguyên.

### 6.8 Vì sao có hình dạng như vậy

- **Lý thuyết thông tin theo cách đơn giản.** Đầu ra phần lớn là dư thừa (lặp, dòng pass, khung stack). Bộ nén loại bỏ phần dư thừa theo mẫu, và giữ lại các dòng hiếm nhưng quan trọng (lỗi) cùng các mốc cấu trúc (phần đầu và dòng tổng kết ở cuối).
- **Giới hạn bất đối xứng.** Trường hợp thất bại được ngân sách lớn hơn trường hợp thành công, vì khi thành công chỉ cần dòng tổng kết, còn khi thất bại cần chi tiết.
- **Cửa sổ lỗi.** Một dòng lỗi không có các dòng lân cận thường vô nghĩa (`expected 3` mà thiếu tên test). Cửa sổ ±2 dòng giữ ngữ cảnh mà một lỗi cần.
- **Không đánh đổi lỗi lấy token.** Cắt một lỗi để tiết kiệm 30 token thường tốn thêm một lần chạy đầy đủ, với toàn bộ hội thoại được gửi lại, khi agent phát hiện phần còn lại. Vì vậy các lỗi khác nhau được giữ tới `maxErrorLines`. Chỉ phần dư thừa bị loại: bản lặp, các bản sao đã gộp của cùng một thông báo, và khung stack.

Đo bằng bộ nén cũ và bộ nén mới trên cùng đầu vào. Đầu vào là các đầu ra tổng hợp có hình dạng giống các lần chạy thật của dotnet, tsc, jest và MSBuild; các hình dạng đó cũng có trong `test/compress.test.mjs`. Ngoài ra có một lần chạy `node --test` thật. "Dữ kiện" là các chuỗi mà agent cần: `file:line` của từng test thất bại, giá trị thực tế, mọi lỗi khác nhau, và dòng tổng kết.

| Đầu ra | Token gốc | Cũ: token, dữ kiện giữ được | Mới: token, dữ kiện giữ được |
|---|---|---|---|
| `dotnet test`, 3 lỗi giữa 1.000 dòng log đa dạng | 25,7k | 959, 8/11 (mất mọi `OrderTests.cs:line N`) | 1.078, 11/11 |
| jest, 12 lỗi trong 665 dòng | 8,9k | 582, 8/25 (mất mọi `file:line`) | 1.543, 25/25 |
| tsc, 150 lỗi khác nhau | 4,7k | 2.437, 79/151 | 4.658, 151/151 |
| MSBuild, 40 lỗi lặp lại trong phần tổng kết, 60 cảnh báo | 15,3k | 4.864, 42/42 | 3.443, 42/42 |
| 2.001 lỗi, 2.000 lỗi cùng một thông báo | 81k | 3.231, mất lỗi khác biệt duy nhất | 3.398, giữ được lỗi khác biệt |
| lỗi nằm sau một lần cập nhật tiến trình bằng `\r` | 2,4k | 50, 0/1 | 66, 1/1 |
| `node --test`, 251 test, 1 thất bại | 9,7k | 313 | 313 (giống hệt) |

### 6.9 Giới hạn của phương pháp heuristic

- `ERROR` khớp từ `error` ở bất cứ đâu, nên dòng tổng kết thành công như `0 errors` bị coi là dòng lỗi và được giữ. Điều này an toàn (giữ nhiều hơn), nhưng không tối giản.
- Các luật là biểu thức chính quy được chỉnh cho công cụ phổ biến. Một công cụ lạ không khớp luật nào chỉ được nén bằng các pha tổng quát (gộp, đầu/cuối).
- Một dòng quan trọng không khớp `ERROR` lẫn `LOCATION`, và cách mọi lỗi hơn 2 dòng, vẫn có thể bị cắt khỏi một đầu ra dài. Hãy thêm một mẫu `run.errors` cho nó. Log đầy đủ luôn có dòng đó.
- Việc gộp coi hai lỗi là "giống nhau" khi nội dung của chúng trùng khớp sau khi bỏ phần `path(line,col):` ở đầu và `[project]` ở cuối. Các lỗi chỉ khác nhau ở một định danh (`'v1'`, `'v2'`) là khác nhau và đều được giữ.
- Các dòng `warn:` của framework ghi log được đếm là cảnh báo.
- Tùy chọn `config.run.noise` và `config.run.errors` cho phép một dự án thêm luật riêng.

---

## 7. Phân loại lệnh và guard

### 7.1 Bộ phân loại

`classifyCommand(cmd)` (`lib/rules.mjs:59`) trả về một trong các loại sau. Thứ tự rất quan trọng:

| Thứ tự | Điều kiện | Loại | Tác động trong guard |
|---|---|---|---|
| 1 | lệnh chứa `tokenkit/tk.mjs` | `wrapped` hoặc `suspicious` (qua `checkWrapped`) | cho qua, hoặc bị từ chối vì giả mạo |
| 2 | không có pipe hoặc chuyển hướng, và khớp một luật `BOUNDED` mà không khớp mẫu `ok` | `unbounded` (+ `hint`, + `soft`) | bị từ chối (luật mềm đo diff trước) |
| 3 | khớp `READERS` (`cat`, `type`, `Get-Content`, `head`, `tail`, …) | `read` (+ `paths`) | kiểm tra đường dẫn bị chặn và kích thước |
| 4 | có pipe hoặc chuyển hướng, hoặc khớp `LONG_RUNNING` (`--watch`, `dev`, `serve`, `start`, …) | `other` | để yên |
| 5 | khớp `VERBOSE` (test, build, cài đặt, lint, typecheck, …) | `verbose` | viết lại hoặc từ chối |
| 6 | mọi trường hợp khác | `other` | để yên |

`BOUNDED` (`rules.mjs:24`) chứa các luật đòi hỏi một giới hạn: `git log` cần `-n N`, `--since`, hoặc tương tự; `git diff`/`show` nên dùng `--stat` hoặc một đường dẫn (mềm); liệt kê đệ quy bị từ chối (`ls -R`, `dir /s`, `Get-ChildItem -Recurse` không có bộ lọc, `find .` không có giới hạn); `docker logs` cần `--tail`; `journalctl` cần `-n`.

`VERBOSE` (`rules.mjs:7`) liệt kê khoảng chục họ công cụ bằng biểu thức chính quy: trình quản lý gói JavaScript, công cụ test và lint Python, Go, Cargo, .NET, Maven và Gradle, make và CMake, Bundler, PHP, Elixir, Swift, Dart, Docker build, và Terraform plan và init.

### 7.2 Wrapper được kiểm tra, không được tin

Khi guard viết lại một lệnh, lệnh mới chứa `tk run … -- <cmd>`. Một mô hình có thể cố lách qua khâu duyệt bằng cách tự viết dạng `tk --b64 <payload>`. Vì vậy `checkWrapped` (`rules.mjs:50`) chỉ chấp nhận một wrapper khi:

1. Payload base64 giải mã thành một lệnh được phân loại là `verbose`, và
2. Nếu có chú thích `# …` ở cuối, nội dung chú thích bằng với payload đã giải mã (để người duyệt trong hộp thoại xem được đúng cái sẽ chạy).

Nếu không, lệnh là `suspicious` và bị từ chối. Đây là một kiểm tra toàn vẹn: hộp thoại duyệt phải hiển thị sự thật.

### 7.3 Viết lại, và vì sao việc đó không tự duyệt

`wrapCommand(cmd, shell, kit)` (`rules.mjs:41`) tạo ra:

- với lệnh đơn giản (chỉ chữ, số và `@%+=:,./ -`): `node "<kit>/tk.mjs" run --shell <shell> -- <cmd>`, dạng này vẫn dễ đọc khi duyệt;
- nếu không: cùng dạng đó nhưng có `--b64 <base64>` và lệnh gốc làm chú thích `# ` ở cuối, giúp việc trích dẫn, `;` và `&&` an toàn.

Đối số `--shell` giữ đúng cú pháp của lệnh: mặc định là `powershell` trên Windows, hoặc `bash` nếu được cấu hình (`guard.shell`). Điều này quan trọng vì cùng một chuỗi có thể mang nghĩa khác nhau trong hai shell.

### 7.4 Đường dẫn bị chặn và giới hạn kích thước

`blockedPath` (`rules.mjs:76`) kiểm tra một đường dẫn với `config.guard.blockPaths` (các biểu thức chính quy gồm `node_modules/`, `dist/`, lockfile, tệp minify và nhị phân, log và snapshot), trừ khi nó khớp `allowPaths`. Kiểm tra kích thước `sizeKB` (`guard.mjs:17`) đọc kích thước tệp bằng `stat`, không đọc nội dung.

### 7.5 Dự phòng khi harness bỏ qua việc viết lại

`commandMode` (`hookio.mjs:80`) xác định chế độ: `auto` nghĩa là `rewrite`, trừ khi `state.json` cho biết VS Code từng bỏ qua việc viết lại, khi đó chế độ là `deny`. Hook post đặt cờ đó khi thấy một lệnh verbose chạy mà không có tiêu đề `[tk]` (mục 4.4). Đây là thiết kế tự điều chỉnh. Từ chối tốn thêm một bước, đắt hơn một lần viết lại, nhưng an toàn khi việc viết lại không hoạt động.

### 7.6 Các điểm bất thường đã biết

- **Lệnh đọc có pipe vẫn được phân loại là đọc.** Kiểm tra `READERS` chạy trước kiểm tra pipe, nên `cat package-lock.json | grep react` được phân loại là `read` với các đường dẫn `["package-lock.json", "|", "grep", "react"]`, và bị từ chối vì lockfile. Trường hợp này vô hại nhưng không chủ đích. Một lệnh đọc có pipe trên tệp lớn không bị chặn cũng bị từ chối khi vượt `maxReadKB`, dù đầu ra của pipe nhỏ.
- **Lệnh không giới hạn có pipe không được kiểm tra** (`git log --oneline | head` là `other`). Điều này có chủ đích: pipe đã giới hạn đầu ra.
- Các luật là biểu thức chính quy trên văn bản lệnh, nên có thể bị qua mặt bằng cách trích dẫn lạ. Chúng là rào chắn cho lỗi thường gặp, không phải ranh giới bảo mật.

---

## 8. Chạy và kiểm tra lệnh

### 8.1 `tk run`

`runCommand` (`lib/run.mjs:33`) thực thi một lệnh, thu toàn bộ đầu ra, và in bản đã nén. Các bước:

1. Ghép chuỗi lệnh. `joinArgs` (`run.mjs:10`) giữ nguyên một đối số duy nhất, nên `tk run "pytest -k 'a and b'"` hoạt động, và trích dẫn khi có nhiều đối số.
2. Chọn shell (`spawnIn`, `run.mjs:24`): `bash -c`, `powershell.exe -Command` (hoặc `pwsh` ngoài Windows), hoặc shell mặc định của nền tảng.
3. Thiết lập môi trường: `CI=1` nếu chưa đặt (nhiều công cụ khi đó bỏ qua hỏi tương tác và thanh tiến trình), `FORCE_COLOR=0`, và `NO_COLOR=1`.
4. Đệm stdout và stderr cùng nhau.
5. Ghi toàn bộ đầu ra vào `run-<timestamp>.log` và `last.log`, và xoay vòng các log cũ để giữ `keepLogs` (10).
6. Trừ khi có `--raw`, nén đầu ra kèm mã thoát và in tiêu đề: `[tk] OK in 3.2s · 1540→29 lines, ~10k→~300 tokens · full log: .tokenkit/logs/run-<timestamp>.log`, theo sau là các ghi chú và văn bản đã nén.
7. Thêm một dòng JSON vào `runs.jsonl` (số token gốc và số token giữ lại), phục vụ `tk report`.

Hai chi tiết: `timeoutSec` mặc định là 0 (không có thời gian chờ), và một tiến trình con không khởi động được được báo là mã thoát 127 với thông báo lỗi trong log.

### 8.2 `tk verify`

`verify` (`lib/verify.mjs:117`) chạy mọi kiểm tra chuẩn trong một lần gọi, nên agent thực hiện một lệnh gọi công cụ thay vì nhiều lệnh.

**Tìm dự án.** `findProjects` (`verify.mjs:41`) tìm các tệp khai báo dự án ở gốc repo và trong các thư mục con sâu tối đa 4 cấp, dùng cùng danh sách tệp với repo map (nên `.gitignore`, `node_modules` và repo lồng nhau được xử lý giống nhau). Một repo có `src/Frontend/package.json` và `src/Backend/Contoso.sln` có hai dự án. Tệp khai báo đã được thư mục cha bao phủ thì bị bỏ: các tệp `.csproj` dưới một thư mục có `.sln`, các gói dưới gốc workspace JS (`"workspaces"` hoặc `pnpm-workspace.yaml`), và các crate dưới một `Cargo.toml` có `[workspace]`.

**Chọn lệnh.** `detectChecks` (`verify.mjs:101`) gán cho mỗi thư mục dự án các kiểm tra ứng với mọi loại tệp khai báo nó chứa:

- **Dự án Node** (`package.json`): tra tên script theo thứ tự ưu tiên. Typecheck: `typecheck`, `type-check`, `tsc`, `check-types`, `types`. Lint: `lint`. Test: `test`, `test:unit`, `unit`. Build (chỉ khi có `--build`): `build`. Script có chữ `watch` bị bỏ qua. Trình quản lý gói lấy từ lockfile (`pnpm-lock.yaml`, `yarn.lock`, `bun.lock[b]`, nếu không thì npm).
- **Python** (`pyproject.toml`, `pytest.ini`, `setup.py`): `python -m pytest -q`.
- **Go** (`go.mod`): `go vet ./...`, `go test ./...`.
- **Rust** (`Cargo.toml`): `cargo check -q`, `cargo test -q`.
- **.NET** (`.sln`, `.slnx`, `.csproj`, `.fsproj`): `dotnet build <tệp> -v q`, `dotnet test <tệp> -v q --no-build`. Tên tệp được ghi rõ vì `dotnet build` từ chối một thư mục chứa nhiều hơn một project hoặc solution. Khi build thất bại, lệnh test `--no-build` của nó được báo là `SKIPPED (build failed)` thay vì lặp lại lỗi build.

Một `verify.checks` không rỗng trong cấu hình sẽ thay thế việc dò tìm: `[{ "label": "api:test", "cwd": "src/Backend", "cmd": "dotnet test Contoso.sln -v q" }]`.

Mỗi kiểm tra chạy trong thư mục dự án của nó qua `runCommand` với `quietOk`, nên kiểm tra thành công chỉ in tiêu đề một dòng, còn kiểm tra thất bại in đầu ra đã nén. Mã thoát là 1 nếu có bất kỳ kiểm tra nào thất bại. Dòng cuối là tóm tắt: `[tk] verify: typecheck OK · lint OK · test FAILED`. Kiểm tra nằm ngoài gốc repo mang theo tên thư mục: `src/Frontend:test OK · src/Backend:build FAILED`.

**`--in <dir>`** giữ các dự án nằm trong `dir`; khi `dir` nằm bên trong một dự án (`--in src/Frontend/src/cart`), nó giữ dự án đó. Nhờ vậy một thay đổi ở frontend không phải build cả solution 9.000 tệp.

---

## 9. Repo map

Repo map (`.tokenkit/repomap.md`) là một chỉ mục ký hiệu, mỗi tệp một dòng, mà agent có thể grep. Mục đích là thay thế các bước "liệt kê, rồi mở, rồi mở tiếp" bằng một lệnh `grep`.

### 9.1 Xây dựng danh sách tệp

`listFiles` (`repomap.mjs:117`) hỏi git các tệp đã theo dõi và các tệp chưa theo dõi nhưng không bị bỏ qua: `git ls-files --cached --others --exclude-standard`. Cách này tự động tôn trọng `.gitignore`. Nếu thư mục không phải kho git, hoặc kết quả rỗng (ví dụ khi một repo cha bỏ qua thư mục này), nó duyệt cây thư mục và bỏ qua `.git`, `node_modules`, `dist`, `build`, `target`, môi trường ảo, cache, và các thư mục khác trong `SKIP_DIRS`.

**Repo lồng nhau** được liệt kê bằng git của chính chúng, nên `.gitignore` riêng của mỗi repo được áp dụng:

- git hiển thị một repo chưa theo dõi nằm trong repo dưới dạng một mục `dir/`; `listFiles` đệ quy vào đó;
- submodule (các đường dẫn trong `.gitmodules`) được mở rộng theo cùng cách;
- khi duyệt một thư mục thường, thư mục con có mục `.git` được liệt kê bằng git thay vì duyệt.

Nhờ vậy một lần cài đặt có thể bao phủ một thư mục chứa repo frontend và repo backend. Repo lồng nhau bị `.gitignore` của repo cha bỏ qua thì không được liệt kê.

`sourceFiles` (`repomap.mjs:168`) sau đó giữ các tệp:

- có phần mở rộng trong bảng ngôn ngữ (`LANGS`, `repomap.mjs:21`): họ JavaScript và TypeScript, Python, Go, C#, Java, Kotlin, Scala, Rust, PHP, Ruby;
- không phải tệp sinh ra (`.min.js`, `.d.ts`, `.g.cs`, `_pb2.py`, `.pb.go`, và tương tự, `GENERATED`);
- không nằm trong `config.map.exclude`.

`buildMap` (`repomap.mjs:178`) trích xuất ký hiệu từ từng tệp. Tệp lớn hơn `maxFileKB` (256 KB) và tệp không đọc được chỉ được liệt kê đường dẫn. Chúng vẫn được đếm, điều này quan trọng với việc kiểm tra độ cũ (mục 9.4).

### 9.2 Trích xuất ký hiệu

`extractSymbols(text, ext)` (`repomap.mjs:81`) là một **bộ quét dòng bằng biểu thức chính quy**, không phải bộ phân tích cú pháp. Với mỗi dòng, nó thử:

1. **Mẫu cấp cao nhất** (`lang.top`). Với JavaScript: `export function|class|const …`, `function name`, `class name`, `const name = (…) =>`, `module.exports.name =`. Với Python: `class`, `def`. Với Go: `func (recv) name`, `func name`, `type name`. Các ngôn ngữ khác tương tự. Lần khớp đầu tiên ghi `{name, line}` và đặt **trạng thái lớp** `inClass` nếu dòng mở một lớp.
2. **Mẫu phương thức** (`lang.method`), chỉ bên trong thân lớp (hoặc luôn luôn với C#, Java, Kotlin, vốn khai báo phương thức có từ khóa bổ nghĩa). Một phương thức được ghi là `.name:line`, tối đa `MAX_METHODS = 15` mỗi tệp, và các từ khóa như `if`, `for`, `return` bị loại.
3. **Thoát thân lớp.** Với JavaScript và Python, một dòng không thụt lề, không trống, và không phải dấu đóng ngoặc sẽ kết thúc lớp (`inClass = false`). Heuristic này giữ cho việc phát hiện phương thức không chạy vào mã cấp cao nhất.

Đầu ra cho một tệp là một dòng: `src/lib/rules.mjs | VERBOSE:7 BOUNDED:24 wrapCommand:41 …`. Tên đi kèm số dòng, và phương thức có dấu chấm ở đầu. Agent có thể grep một tên và nhận được tệp và số dòng.

Giới hạn của cách này: chữ ký nhiều dòng, mã sinh ra lúc chạy, và định dạng bất thường có thể bị bỏ sót. Map là một **chỉ mục gợi ý**, và chỉ dẫn yêu cầu agent đọc đoạn và xác nhận.

### 9.3 Repo lớn: map chỉ để grep và bản tổng quan thư mục

Agent được dặn **grep** map, không bao giờ đọc cả tệp, và guard từ chối việc đọc cả tệp lớn hơn `guard.maxReadKB` (48 KB). Vì vậy map luôn liệt kê mọi tệp mã nguồn với đầy đủ chi tiết, bất kể kích thước. Tiêu đề ghi kích thước: `# Repo map · 10501 source files · ~1.3M tokens · …`.

Các phiên bản trước giảm chi tiết để vừa `maxTokens` (4.000): bỏ phương thức, rồi chỉ còn đường dẫn, rồi chỉ còn số tệp theo thư mục. Cách đó thất bại với repo lớn. 10.000 tệp không vừa 4.000 token ngay cả khi chỉ là đường dẫn (khoảng 150k token), nên map tụt xuống số tệp theo thư mục, không trả lời được "tệp nào" lẫn "dòng nào". Bộ so khớp vị trí (mục 10) cũng không còn gì để khớp.

Khi vượt `maxTokens`, có hai thay đổi:

- Dòng tiêu đề thứ hai của map nói rằng nó quá lớn để đọc cả tệp, và chỉ đến bản tổng quan.
- `buildOverview` (`repomap.mjs:215`) ghi `.tokenkit/areas.md`, một bản tổng quan thư mục nằm trong `maxTokens`. Nó liệt kê các thư mục kèm số tệp và các thư mục con đầu tiên, ở độ sâu thư mục lớn nhất còn vừa ngân sách:

```text
# Folder overview · 10501 source files · symbols: grep .tokenkit/repomap.md
src/Backend/Contoso.Billing/ (450 files): Commands Configurations Controllers Dtos Entities … (+3)
src/Frontend/src/ (1500 files): features
```

Bản tổng quan trả lời "khu vực nào"; grep map trả lời "tệp nào, dòng nào". Repo nhỏ không đổi: một map, không có bản tổng quan.

### 9.4 Độ cũ

`mapIsStale(root, mapFile)` (`repomap.mjs:242`) trả về một chuỗi lý do, hoặc `null` khi map còn mới. Nó kiểm tra theo thứ tự và dừng ở lần khớp đầu tiên:

1. Map thiếu hoặc không đọc được: `missing`.
2. Map được ghi bởi tokenkit phiên bản cũ (tiêu đề có `detail level`): `old format`.
3. Map cũ hơn `maxAgeMinutes` (60): `old`.
4. Số tệp mã nguồn trong tiêu đề khác với số tệp hiện đang được liệt kê: `file count changed`. (Tệp mới hoặc bị xóa làm đổi số đếm.)
5. Có tệp mã nguồn nào có `mtime` mới hơn map: `files changed`.

Kiểm tra này tốn một lần `git ls-files` và một lần `stat` cho mỗi tệp mã nguồn. Nó không đọc nội dung tệp, và được chạy ở mọi prompt (`prompt.mjs`) và mọi lần bắt đầu phiên (`session.mjs`).

Kiểm tra 4 chỉ đúng khi hai bên đếm cùng một tập tệp. Đó là lý do `buildMap` và `mapIsStale` dùng chung `sourceFiles`, và lý do tệp quá lớn được liệt kê thay vì bị bỏ. Các phiên bản trước bỏ tệp lớn hơn `maxFileKB` (và tệp khớp `map.exclude`) khỏi map nhưng vẫn đếm chúng ở đây. Trong một repo chỉ cần có một tệp như vậy, ví dụ model snapshot của EF Core hoặc `Reference.cs` của WCF, map trông như cũ mãi mãi. Mỗi prompt lại xây dựng lại từ đầu và có thể vượt thời gian chờ 10 giây của hook prompt.

**Xây dựng lại tăng dần.** `writeMap` (`repomap.mjs:261`) giữ một cache theo từng tệp trong `.tokenkit/cache/repomap.json` (`[mtime, size, symbols]` cho mỗi đường dẫn). Khi xây dựng lại, nó `stat` mọi tệp nhưng chỉ đọc lại các tệp có mtime hoặc kích thước thay đổi. Cache bị bỏ khi `maxFileKB` hoặc `CACHE_VERSION` (tăng khi bộ trích xuất thay đổi) khác đi.

Đo trên một repo tổng hợp 10.500 tệp (9.000 C#, 1.500 TSX) trên Windows:

| Bước | Thời gian |
|---|---|
| `mapIsStale` (liệt kê + 10.500 lần stat) | ~0,4 s |
| xây dựng đầy đủ, không có cache | ~1,8 s khi đĩa đã được cache; lâu hơn nhiều khi đĩa nguội hoặc bị phần mềm diệt virus quét |
| xây dựng lại có cache, không có gì thay đổi | ~0,6 s |
| toàn bộ hook prompt (kiểm tra độ cũ, xây dựng lại, gợi ý) | ~1,5 s trên giới hạn 10 s |

`tk doctor` chạy hook session và hook prompt trên một map cố ý để cũ, và báo thời gian của chúng so với `timeoutSec` của từng hook.

### 9.5 Phân giải `file#symbol`

`findSymbol(root, path, name)` (`repomap.mjs:280`) chạy cùng bộ trích xuất trên tệp, tìm ký hiệu, và trả về khoảng của nó: từ dòng của ký hiệu đến dòng ngay trước ký hiệu kế tiếp. Với một phương thức, ký hiệu kế tiếp bất kỳ loại nào sẽ kết thúc khoảng. Với một ký hiệu cấp cao nhất, khoảng kết thúc trước ký hiệu cấp cao nhất kế tiếp, nên thân các phương thức của một lớp được bao gồm. Đây là cách `@src/cart.js#applyDiscount` trở thành `lines 6-7`.

---

## 10. Gợi ý vị trí

Hook prompt biến một yêu cầu bằng ngôn ngữ tự nhiên thành "hãy bắt đầu đọc ở đây". Đây là phần mang tính heuristic nhất của tokenkit, và cũng là phần được chỉnh kỹ nhất để đảm bảo độ chính xác.

### 10.1 Bước 1: trích xuất cue

`extractCues(prompt)` (`locate.mjs:77`) tạo ra bốn loại cue:

| Cue | Cách tìm | Ví dụ |
|---|---|---|
| `idents` | văn bản trong dấu backtick, hoặc định danh trông như mã (có chuyển từ chữ thường sang chữ hoa, `_`, hoặc `.`, hoặc bắt đầu bằng một từ viết hoa rồi một chữ hoa khác, như `MyClass`) | `` `applyDiscount` `` → `applyDiscount`; `classifyCommand` → `classifyCommand` |
| `paths` | các token trông như đường dẫn tệp có phần mở rộng quen thuộc | `src/cart.js` |
| `words` | các từ có ba chữ cái trở lên sau khi tách camelCase và snake_case, chuyển thành chữ thường, và bỏ danh sách từ dừng | `discount`, `applied` |
| `joined` | các cặp từ không phải từ dừng đứng liền nhau, ghép không khoảng trắng | `discountapplied`, `repomapbuilt` |

Danh sách từ dừng `STOP` (`locate.mjs:10`) loại bỏ các từ chức năng (`the`, `and`), động từ yêu cầu (`fix`, `add`, `check`), và danh từ mã chung chung (`file`, `function`, `value`). Nếu không có danh sách này, gần như mọi yêu cầu sẽ khớp với gần như mọi tệp.

### 10.2 Bước 2: chấm điểm mọi ký hiệu và tệp

Với mỗi tệp trong map, `locate` tính một **điểm tệp** và một **điểm ký hiệu**:

**Điểm tệp** (tổng của):

| Bằng chứng | Điểm |
|---|---|
| prompt nêu đường dẫn tệp (hoặc tên cơ sở) | +10 |
| một từ khớp với tên cơ sở của tệp, và tên cơ sở không chung chung (`index`, `utils`, `test`, …) | +6 |
| mỗi từ khớp với tên một thư mục (không chung chung) | +2 mỗi từ |

**Điểm ký hiệu** (lấy mức cao nhất trong các mức sau):

| Bằng chứng | Điểm |
|---|---|
| một định danh trong prompt bằng đúng tên ký hiệu | +10 |
| một định danh khớp không phân biệt hoa thường | +8 |
| một cặp từ ghép khớp tên ký hiệu | +8 |
| các phần từ của tên ký hiệu khớp từ trong prompt: 3 mỗi từ khớp, cộng 2 nếu số từ khớp không ít hơn số phần của tên | biến thiên |

Tổng điểm của một ký hiệu là điểm ký hiệu **cộng điểm tệp**, nên một hàm trong tệp có tên khớp với yêu cầu sẽ xếp trên cùng tên hàm nằm trong một tệp không liên quan. Một tệp không có ký hiệu khớp nhưng có điểm tệp ít nhất bằng `minScore` (5) sẽ tự thành một ứng viên, không kèm khoảng dòng.

Khớp từ dùng `wordsMatch(a, b)`, so sánh **gốc từ** (stem). `stem` (`locate.mjs:42`) bỏ một hậu tố trong danh sách cố định (`ization`, `ations`, `ator`, `ing`, `ed`, `s`, …), rồi bỏ chữ `e` cuối, đổi `y` thành `i`, và bỏ phụ âm cuối bị lặp. Vì vậy `applied` và `apply` khớp nhau, `validation` và `validate` khớp, `compressor` và `compress` khớp. Đây là bộ tách gốc từ nhẹ, không phải bộ phân tích ngôn ngữ. Cặp `repo`/`report` được giữ tách biệt vì danh sách hậu tố không bỏ được `ort`.

### 10.3 Bước 3: chọn gợi ý

Việc chọn gợi ý được thiết kế để thận trọng:

1. **Ngưỡng sàn.** Một ứng viên được giữ nếu `score ≥ max(minScore, ⌈top / 2⌉)`. Các ứng viên yếu hơn nhiều so với khớp tốt nhất bị loại.
2. **Kiểm tra mơ hồ.** Nếu hơn 20 ứng viên vượt ngưỡng sàn và điểm cao nhất dưới 8, prompt được coi là mơ hồ. Kết quả là không có gợi ý nào. Chú thích trong mã nói thẳng: nhiều ứng viên yếu, ngang nhau sẽ gây hiểu lầm hơn là giúp ích.
3. **Đa dạng.** Mỗi tệp tối đa hai ký hiệu, không có khóa `path#symbol` trùng, và tối đa `maxHints` (5) gợi ý tổng cộng.
4. **Hòa điểm.** Một phương thức thắng lớp chứa nó (phương thức là khoảng nhỏ hơn để đọc), sau đó thứ tự đường dẫn quyết định, nên kết quả có thể tái lập.

Đầu ra là một khối ngắn kèm bằng chứng:

```text
[tokenkit] Likely locations for this request (repo-map match on: compress). Read these ranges first; search only if they turn out wrong:
- src/lib/compress.mjs:72-257  compress
```

### 10.4 Ví dụ minh họa (chạy trên repo này)

Các ví dụ này lấy từ `tk locate --why` trên chính repo này.

| Yêu cầu | Cue | Kết quả | Phép tính điểm |
|---|---|---|---|
| `compress collapses repeated lines` | từ: `compress`, `collapses`, `repeated` | `src/lib/compress.mjs:72-257 compress` | ký hiệu `compress`: khớp từ 3 + 2 (khớp đủ mọi phần) = 5; tên cơ sở `compress` +6; tổng 11 |
| `where is the repo map built and when is it refreshed` | từ: `repo`, `map`, `built`, `refreshed`; ghép `repomap` | `buildMap` và `mapIsStale` trong `repomap.mjs` | tên cơ sở `repomap` khớp ghép `repomap` +6; ký hiệu `mapIsStale`: từ `map` 3; tổng 9 |
| `classifyCommand decides the guard action` | định danh `classifyCommand`; từ `guard`, `action` | `rules.mjs:59-75 classifyCommand`, rồi `guard.mjs` | định danh đúng +10; tệp `guard.mjs` có từ `guard` trong tên cơ sở +6 |
| `the discount is applied twice` | từ `discount`, `applied`, ghép `discountapplied` | không có gợi ý | repo này không có mã giảm giá, nên không ứng viên nào đạt ngưỡng sàn, và đầu ra ghi `no confident match` |

Dòng cuối là nguyên tắc độ chính xác đang hoạt động: công cụ chọn không nói gì thay vì đoán.

### 10.5 Vì sao không dùng embedding hay BM25?

Bộ so khớp là một bộ chấm điểm từ vựng do con người viết, trên các trường có cấu trúc (đường dẫn, tên cơ sở, thư mục, tên ký hiệu). Nó gần với một hàm xếp hạng có trọng số theo trường hơn là một công cụ tìm kiếm:

- Nó **không có IDF**. Các từ phổ biến trong repo không bị giảm trọng số, và danh sách từ dừng cùng danh sách tên đường dẫn chung chung đảm nhiệm việc đó.
- Nó **không có mô hình embedding**, nên không khớp được từ đồng nghĩa. Một yêu cầu không bao giờ nêu tên mã (ví dụ "tổng tiền bị sai") sẽ không có gợi ý.
- Nó **chạy offline và tái lập được**, và không có dịch vụ chỉ mục cần đồng bộ.

Đây là sự đánh đổi có chủ đích. Gợi ý là bước đầu rẻ tiền, và chỉ dẫn yêu cầu quay về grep khi gợi ý sai.

---

## 11. TaskSpec

TaskSpec là một ký pháp một dòng cho các sự kiện mà agent nếu không có nó sẽ phải tốn bước để khám phá. Văn phạm của nó, như được triển khai trong `parseSpec` (`spec.mjs:46`):

```
spec   := [verb] token*
verb   := fix | add | ref | test | rev | explain | doc | perf      (bí danh: refactor→ref, review→rev)
token  := "@" path [ ":" L1 ["-" L2] | "#" Symbol ]               phạm vi
        | flag                                                    một trong các khóa của FLAG_DEFS
        | word                                                    nội dung mục tiêu
flag   := ">diff" | ">plan" | ">ans" | "+test" | "^min" | "^api" | "^nodeps" | "!run"
```

Chi tiết phân tích:

- Động từ chỉ được nhận diện khi là **token đầu tiên**, không phân biệt hoa thường. Nếu không, dòng là văn bản mục tiêu thông thường.
- Chuỗi trong dấu nháy là một token (`tokenize`, `spec.mjs:40`).
- Phạm vi sai dạng (`@` theo sau bởi thứ không khớp) và cờ có dạng lạ (`>xyz` không có trong `FLAG_DEFS`) được gom vào `unknown` và được báo cáo, không bị bỏ lặng lẽ.
- Mọi thứ không phải động từ, phạm vi hoặc cờ đều được nối thành nội dung mục tiêu.

`expandSpec` (`spec.mjs:70`) biến dạng đã phân tích thành văn bản prompt. Phạm vi được phân giải qua `findSymbol`, nên `#applyDiscount` trở thành `lines 6-7`. Các cờ được tách thành **ràng buộc** (`+`, `^`, `!`) và **dạng đầu ra** (`>`). Dạng đầu ra là phần quan trọng nhất với chi phí, vì nó giới hạn độ dài câu trả lời: `>diff` yêu cầu một dòng, `>ans` năm dòng, `>plan` bảy gạch đầu dòng.

Hook prompt chỉ áp dụng TaskSpec nếu dòng có động từ **và** có ít nhất một phạm vi hoặc cờ (`prompt.mjs`, mục 4.2). Một câu thường bắt đầu bằng "fix" sẽ không bị chuyển đổi. Phần chú giải trong chỉ dẫn và trong `templates/.github/prompts/spec.prompt.md` được sinh từ `FLAG_DEFS` và `VERBS` bằng `tk spec --legend`. Một kiểm thử (`test/cli.test.mjs:65`) thất bại nếu `spec.prompt.md` không chứa chú giải hiện tại. Chú giải trong `copilot-instructions.md` không được kiểm tra bởi kiểm thử đó. Nó được dán tay, nên mỗi thay đổi về động từ hoặc cờ cần dán lại.

---

## 12. Kiểm toán ngân sách ngữ cảnh

`audit(root)` (`budget.mjs:62`) đo những gì Copilot gửi trong **mọi** yêu cầu, và những gì nó chỉ nạp khi cần:

- **Luôn bật:** `.github/copilot-instructions.md`, `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, các `.github/instructions/*.instructions.md` có glob `applyTo` thực chất áp dụng cho mọi tệp (`**`, `*`, `**/*.*`), và tên cùng mô tả của mỗi skill (cộng 8 token chi phí phụ).
- **Theo yêu cầu:** nội dung của mỗi `SKILL.md`, chỉ dẫn theo đường dẫn, agent, prompt, và chế độ chat.

Mỗi văn bản được định giá bằng `estimateTokens`. Tổng được so với `alwaysOnTokens` (1200). `tk budget --ci` thoát với mã 1 khi tổng vượt ngân sách, nên có thể dùng làm cổng CI.

Bộ kiểm tra lỗi (`lint`, `budget.mjs:43`) tìm các dạng phình to mà nghiên cứu trong [COMPARE.md](COMPARE.md) đã cho thấy là quan trọng:

- khối mã dài hơn 8 dòng trong văn bản luôn bật (những khối này thuộc về một skill);
- các cụm từ thừa (`please`, `make sure to`, `it is important that`, `you should`, `in order to`, …), vì chỉ dẫn được đọc theo nghĩa đen và phần thừa chỉ thêm token mà không thêm chỉ dẫn;
- đoạn văn dài hơn 400 ký tự;
- dòng trùng lặp giữa các tệp chỉ dẫn luôn bật (đã chuẩn hóa thành chữ thường và chữ số, và dài ít nhất 24 ký tự);
- nhiều hơn một tệp chỉ dẫn luôn bật (ba tệp được nạp cùng nhau, nên một tệp nên là con trỏ);
- tên skill không khớp tên thư mục (một lỗi im lặng trong Copilot), thiếu mô tả, và mô tả dài hơn 300 ký tự;
- các máy chủ MCP, vốn thêm schema công cụ vào mọi yêu cầu, và việc bật/tắt chúng giữa phiên, vốn làm hỏng cache prompt.

`parseFrontmatter` (`budget.mjs:12`) là một bộ đọc YAML nhỏ cho phần front matter của các tệp này. Nó xử lý giá trị một dòng và các block scalar `>` và `|`, đó là tất cả những gì các template dùng.

---

## 13. Đo lường

Việc đo lường có hai tầng, và sự khác biệt quyết định điều bạn có thể kết luận.

### 13.1 Tiết kiệm ước lượng (`tk report`)

`report` (`report.mjs:13`) đọc các log JSON-lines cục bộ trong `.tokenkit/logs/` trong N ngày gần nhất:

| Log | Được ghi bởi | Nội dung |
|---|---|---|
| `runs.jsonl` | `tk run` | số token gốc và số token giữ lại của mỗi lệnh |
| `tools.jsonl` | `post.mjs` | số token của mọi đầu ra công cụ, và số token giữ lại khi đã nén |
| `prompt.jsonl` | `prompt.mjs` | gợi ý hoặc mở rộng TaskSpec, với kích thước |
| `guard.jsonl` | `guard.mjs` | mọi lần từ chối, viết lại, hoặc dự phòng, kèm luật đã kích hoạt |
| `errors.jsonl` | `runHook` | các ngoại lệ đã bắt được |
| `session.jsonl` | `session.mjs` | các lần làm mới map, kèm lý do |

Đây là **ước lượng**: phần tiết kiệm được tính bằng `estimateTokens`, và "tiết kiệm" nghĩa là "lẽ ra đã được thêm vào ngữ cảnh". Chúng không cho biết mô hình thực sự bị tính bao nhiêu.

### 13.2 Số liệu chính xác (`tk usage`)

`usage.mjs` đọc những gì chính VS Code ghi lại. Nó tìm thư mục workspace storage của thư mục bằng cách khớp `workspace.json` (`findWorkspaceStorage`, `usage.mjs:28`), đọc từng phiên trong `chatSessions/`, và tóm tắt (`summarizeSession`, `usage.mjs:44`):

- số lượt, số lệnh gọi công cụ theo nhóm (terminal, browser, read, search, edit), và số lần gọi mô hình (`toolCallRounds`);
- kích thước prompt lớn nhất đã thấy (`promptTokens`), và số token đầu ra;
- thành phần prompt ở đầu và cuối (`promptTokenDetails`, tỷ trọng của chỉ dẫn hệ thống, định nghĩa công cụ, tin nhắn và kết quả công cụ);
- tín dụng được ghi nhận trên một số bước.

Khi người dùng bật `github.copilot.chat.agentDebugLog.fileLogging.enabled`, VS Code cũng ghi một **Agent Debug Log** cho mỗi phiên. `debugLogStats` (`usage.mjs:123`) đọc nó để lấy số liệu chính xác theo từng lần gọi: số lần gọi mô hình, token đầu vào, token đã cache, token đầu ra, số lệnh gọi công cụ, và sự kiện hook. Nó cũng đếm các hành động của chính tokenkit bằng cách tìm `updatedInput` có `tk.mjs`, các lần từ chối `[tokenkit]`, và các dấu hiệu gợi ý.

`formatCompare` (`usage.mjs:173`) đặt hai thư mục cạnh nhau và đánh dấu thay đổi. Các dòng của nó được gắn nhãn `EXACT` khi có debug log. Định dạng tệp là nội bộ của VS Code, nên bộ đọc này chỉ mang tính tham khảo và có thể hỏng ở phiên bản tương lai.

### 13.3 Vì sao cần hai phép đo

Bộ ước lượng đủ tốt để chọn giữa các luật nén, nhưng nó không ghi nhận việc tính tiền cho cache hit, token suy luận, hay các bước mà VS Code không ghi. Log chính xác ghi nhận đầu vào của việc tính tiền, nhưng chỉ cho các phiên bắt đầu sau khi bật log, và chỉ cho các trường mà VS Code ghi. [COMPARE.md](COMPARE.md) ghi lại bài học từ chính các lần chạy của tác giả: một so sánh công bằng cần cùng một công việc, cùng mô hình, và nhiều lần chạy, vì một đường đi khác nhau của các lệnh gọi công cụ khác nhau nhiều hơn rất nhiều so với phần tokenkit tiết kiệm. Trong một lần so sánh, tokenkit nén 82 lần chạy lệnh (khoảng 60k → 15k token), nhưng phiên đó vẫn ghi nhận nhiều tín dụng hơn, vì agent đã thực hiện nhiều bước hơn.

---

## 14. Cài đặt, nâng cấp và gỡ bỏ

### 14.1 Cài đặt làm gì

`install(target, {dryRun, force})` (`install.mjs:32`) thực hiện bốn bước:

1. **Runtime.** Sao chép `src/` vào `<target>/.tokenkit/`, bỏ qua các tệp được sinh ra (`logs/`, `repomap.md`, `areas.md`, `cache/`) và `config.json` đã có (cấu hình của người dùng được giữ lại).
2. **Template.** Với mỗi tệp dưới `templates/`, quyết định hành động (bảng dưới).
3. **`.gitignore`.** Thêm `.tokenkit/logs/`, `.tokenkit/repomap.md`, `.tokenkit/areas.md`, `.tokenkit/cache/` và `.tokenkit/handoff.md` nếu còn thiếu.
4. **Repo map.** Xây dựng `repomap.md` đầu tiên cùng cache ký hiệu của nó, để các lần hook xây dựng lại sau này là tăng dần.

### 14.2 Máy trạng thái của manifest

Bộ cài đặt phải nâng cấp các tệp mà nó đã ghi, nhưng không bao giờ được ghi đè một tệp mà người dùng đã sửa. Nó ghi lại hash SHA-256 của mỗi template đã ghi, được cắt còn 16 ký tự hex, vào `.tokenkit/manifest.json`. Hash được tính sau khi chuẩn hóa CRLF thành LF, nên kết thúc dòng kiểu Windows và Unix được coi là bằng nhau. Với mỗi đường dẫn template, trong đó `cur` là tệp hiện tại, `tpl` là template mới, và `m` là hash trong manifest:

| Điều kiện | Hành động | Từ ghi log |
|---|---|---|
| `cur` không tồn tại | ghi `tpl` và ghi nhận | `created` |
| đặt `force` | ghi đè và ghi nhận | `replaced` |
| `hash(cur) = hash(tpl)` | không có gì để ghi; ghi nhận | `unchanged` |
| `m = hash(cur)` (người dùng chưa sửa tệp kể từ khi tokenkit ghi nó) | ghi `tpl` mới | `updated` |
| trường hợp khác (đã sửa cục bộ, hoặc không do tokenkit tạo) | giữ nguyên tệp | `skipped` |

Ngoại lệ duy nhất là `.github/copilot-instructions.md`. Nó được **gộp**, không được thay thế. `mergeBlock` (`install.mjs:25`) chỉ thay văn bản nằm giữa `<!-- tokenkit:start -->` và `<!-- tokenkit:end -->`, hoặc thêm khối vào cuối nếu thiếu dấu. Quy tắc riêng của người dùng không bao giờ bị động đến.

Các tệp mà phiên bản cũ đã cài nhưng phiên bản hiện tại không còn cung cấp sẽ bị **thu hồi**: xóa nếu chưa bị sửa, giữ lại kèm ghi chú nếu đã sửa. Nếu không, các tệp "chết" sẽ tiếp tục tốn token.

### 14.3 Vì sao dùng hash thay vì thời gian sửa đổi

Thời gian sửa đổi cho biết khi nào tệp thay đổi, không cho biết người dùng có thay đổi nó hay không. Hash của nội dung cho biết tệp còn khớp với những gì tokenkit đã ghi hay không. Đó là cách kiểm tra duy nhất đáng tin cậy cho "chưa bị sửa kể từ khi cài", và nó vẫn đúng sau `git checkout`, sao chép, và chuyển đổi kết thúc dòng.

### 14.4 Gỡ bỏ

`uninstall` (`install.mjs:123`) đảo ngược quá trình với cùng manifest. Nó chỉ xóa một tệp nếu hash của tệp vẫn khớp manifest, gỡ khối tokenkit khỏi tệp chỉ dẫn (giữ lại phần còn lại), gỡ các dòng `.gitignore` của tokenkit, và xóa `.tokenkit/`. Tệp đã sửa được báo là `kept`.

---

## 15. Kiểm tra sức khỏe

`doctor(root)` (`lib/doctor.mjs:14`) là một bài kiểm thử đầu cuối của repo đã cài. Nó không chỉ kiểm tra tệp có tồn tại. Nó **chạy từng lệnh hook trong `tokenkit.json`** qua shell của nền tảng, với một payload mẫu, trong thư mục log tạm để thống kê của repo không bị lẫn:

| Kiểm tra | Payload | Thành công nghĩa là |
|---|---|---|
| guard chặn lockfile | `read_file` trên `package-lock.json` | guard trả về quyết định `deny` |
| guard định tuyến `npm test` | `run_in_terminal` với `npm test` | guard trả về `updatedInput` chạy qua `tk.mjs` (hoặc deny ở chế độ deny) |
| `userPromptSubmitted` chạy | một prompt, sau khi làm cũ repo map | thoát 0 trong `timeoutSec` của nó |
| `postToolUse` chạy | một đầu ra terminal | thoát 0 trong `timeoutSec` của nó |
| `sessionStart` chạy | không có công cụ, sau khi làm cũ repo map | thoát 0 trong `timeoutSec` của nó |

Mỗi hook chạy với `timeoutSec` riêng trong `tokenkit.json`, giống VS Code, vốn hủy hook chạy chậm. Trước khi chạy hook prompt và hook session, doctor lùi mtime của map một ngày, để chúng đi theo nhánh chậm (làm mới map) mà VS Code sẽ gặp. Hook hết thời gian thì kiểm tra thất bại. Hook dùng hơn một nửa giới hạn thì nhận cảnh báo, kèm gợi ý dùng `map.exclude`. Mỗi dòng ghi thời gian đã dùng: `userPromptSubmitted hook runs (2.0s of its 10s limit, refreshing a stale map)`.

Nó cũng kiểm tra tệp hook, khối chỉ dẫn, repo map, `.gitignore`, việc `.tokenkit/` có được commit hay không, và ngân sách luôn bật. Hook fail open, nên lỗi của chúng không hiện ra trong VS Code. Vì vậy doctor cũng báo các mục trong 7 ngày gần nhất của `.tokenkit/logs/errors.jsonl`.

Điều doctor không thể kiểm tra là những gì chỉ VS Code biết: Workspace Trust, chính sách hook của tổ chức, và việc "Chat: Configure Hooks" có liệt kê tệp hay không. Đầu ra nói rõ điều này.

---

## 16. Một vết thực thi: "run the tests"

Phần này theo dõi một yêu cầu trong VS Code qua mọi cơ chế. Người dùng gõ `run the tests`, và dự án có script `test` trong `package.json`.

1. **Bắt đầu phiên.** Khi phiên chat bắt đầu, `session.mjs` chạy `mapIsStale`. Map còn mới, nên không có gì xảy ra và hook không in gì.

2. **Prompt được gửi.** `prompt.mjs` nhận `run the tests`. Nó dài 13 ký tự, nên vượt qua ngưỡng tối thiểu 8. `parseSpec` không tìm thấy động từ, nên đây không phải TaskSpec. `mapIsStale` vẫn cho biết map còn mới. `locate` trích xuất cue. `run` và `tests` nằm trong danh sách từ dừng, nên không còn cue nào (`no cues`), và hook ghi `kind: none` và không thêm gì. Danh sách từ dừng làm đúng việc của nó ở đây: yêu cầu không nêu tên mã nào.

3. **Agent lên kế hoạch một lệnh gọi.** Mô hình, theo chỉ dẫn, quyết định chạy test bằng `node .tokenkit/tk.mjs run -- npm test`, hoặc bằng `npm test` thường. Giả sử là trường hợp thứ hai.

4. **Hook trước công cụ.** `guard.mjs` chuẩn hóa payload. Đây là công cụ shell, nên nó chạy các luật theo thứ tự. `classifyCommand("npm test")` trả về: không phải wrapper; không phải không giới hạn (không có luật `BOUNDED` nào khớp); không phải lệnh đọc; không có pipe; khớp `VERBOSE` → `verbose`. Chế độ là `auto`, nên `commandMode` trả về `rewrite`, và `shellFor` chọn `powershell` trên Windows. `wrapCommand` tạo `node "…/.tokenkit/tk.mjs" run --shell powershell -- npm test`, đủ đơn giản để dễ đọc, nên không bọc base64. `emitRewrite` trả về nó dưới dạng `updatedInput`, và log có một mục `rewrite`. Hộp thoại duyệt hiển thị lệnh đã viết lại, không phải `npm test` nguyên bản.

5. **Thực thi.** Harness chạy lệnh đã viết lại. `tk.mjs` chuyển `run` đến `runCommand`. Nó khởi chạy `powershell.exe -NoProfile -NonInteractive -Command "npm test"` với `CI=1` và không có màu, rồi đệm đầu ra. Giả sử 40 test thất bại, và đầu ra dài 1.540 dòng.

6. **Nén.** Toàn bộ đầu ra được ghi vào `run-<time>.log` và `last.log`. `compress` chạy với `exitCode = 1`. Các dòng được chuẩn hóa. Các khung thư viện được gộp. Các dòng tiến trình và test pass bị bỏ và được đếm. Các dòng lặp được gộp. Có nhiều hơn 80 hàng, nên giữ 6 hàng đầu và 20 hàng cuối, và các cửa sổ lỗi được thêm theo thứ tự miễn là còn nằm trong 80. Kết quả khoảng 29 dòng.

7. **Đầu ra.** `runCommand` in `[tk] FAILED exit 1 in 6.4s · 1540→29 lines, ~10k→~300 tokens · full log: .tokenkit/logs/run-<timestamp>.log`, rồi các ghi chú (ví dụ `1204 passing-test line(s) hidden`), rồi văn bản đã nén. Một dòng được thêm vào `runs.jsonl`.

8. **Hook sau công cụ.** `post.mjs` chạy trên kết quả công cụ. Trong VS Code (`!camel`), nó chỉ ghi kích thước đầu ra vào `tools.jsonl`. Nó cũng kiểm tra điều kiện dự phòng: đầu ra bắt đầu bằng `[tk]`, tức việc viết lại đã thành công, nên không có gì được ghi vào `state.json`. Kết quả không bị thay thế, vì VS Code không hỗ trợ điều đó.

9. **Bước tiếp theo.** Agent đọc 29 dòng. Nếu cần thêm, tiêu đề cho biết log đầy đủ nằm ở đâu, và agent grep tệp đó thay vì đọc cả tệp. Lần kiểm tra tiếp theo là một lệnh gọi (`tk verify`), không phải ba.

Tổng tác động lên ngữ cảnh của agent là khác biệt giữa khoảng 10k và khoảng 300 token cho bước này, và 300 token đó sau đó được gửi lại ở mọi bước còn lại của lượt (mục 1.4).

---

## 17. Giới hạn, giả định và các điểm bất thường đã biết

**Giả định trong mô hình chi phí.** Mô hình ở mục 1 giả định cache hit khoảng 10% giá đầu vào, một mức giá duy nhất cho lần gửi đầu tiên, và các bước đều gửi lại toàn bộ ngữ cảnh. Việc tính tiền thực tế có phí ghi cache, cửa sổ cache riêng của từng nhà cung cấp, token suy luận, và giá riêng của từng mô hình. Hình dạng của kết luận (đầu ra sớm và lớn quan trọng nhất; số bước nhân mọi thứ) vẫn đúng qua các biến thể đó. Các hệ số nhân chính xác thì không.

**Độ chính xác của bộ ước lượng.** Bộ ước lượng nằm trong khoảng ±20% so với bộ tách BPE theo chú thích của chính nó. Các phép đo của tác giả (README) và số liệu VS Code chính xác (COMPARE) là bằng chứng cho phần tiết kiệm thực tế. Tài liệu này không đo lại chúng.

**Bộ phân tích là biểu thức chính quy.** Việc trích xuất ký hiệu và phân loại lệnh không phân tích cú pháp các ngôn ngữ mà chúng mô tả. Chúng bỏ sót định dạng bất thường và có thể khớp quá mức. Vì lý do đó, repo map được ghi nhận là một chỉ mục gợi ý.

**Bề mặt đang ở giai đoạn xem trước.** Hook của VS Code và các trường payload của chúng là tính năng Preview. `hookio.mjs` là nơi duy nhất biết cả hai dạng, nên thay đổi tên trường chỉ cần sửa một tệp. Cơ chế dự phòng `localRewriteIgnored` tồn tại vì một bản build VS Code có thể bỏ việc viết lại mà không báo trước.

**Trong VS Code chỉ đầu ra terminal được nén.** Tasks, công cụ báo lỗi test, và công cụ MCP đi tắt qua terminal, và VS Code không thể thay thế đầu ra của chúng sau khi chúng chạy. Agent `lean` và các skill hướng agent về các lần chạy qua terminal vì lý do đó.

**Guard là rào chắn, không phải hộp cát.** Các luật của nó là biểu thức chính quy trên văn bản lệnh. Nó giảm lỗi và lãng phí. Nó không phải một biện pháp bảo mật, và nó không ngăn một lệnh cố ý làm bất cứ điều gì.

**Các điểm bất thường đã biết, tổng hợp:**

- Lệnh đọc có pipe được phân loại là lệnh đọc (mục 7.6).
- `ERROR` khớp từ `error` trong dòng tổng kết thành công, nên các dòng `0 errors` được giữ lại (mục 6.9).
- `mapIsStale` gọi `stat` trên mọi tệp mã nguồn ở mỗi prompt, nên chi phí tăng tuyến tính theo kích thước repo: khoảng 0,4 s cho 10.500 tệp (mục 9.4).
- Bộ so khớp vị trí không có IDF và không có từ đồng nghĩa, nên bỏ sót các yêu cầu không nêu tên mã (mục 10.5).
- Kiểm thử: `node --test "test/*.test.mjs"` (script `npm test`) chạy 57 test trong repo hiện tại, và tất cả đều pass.

---

## 18. Bản đồ mã nguồn

| Mối quan tâm | Tệp | Hàm chính (dòng) | Ghi chú |
|---|---|---|---|
| Điều phối CLI | `src/tk.mjs` | `main` | một `switch` theo đối số đầu tiên |
| Ước lượng token | `src/lib/tokens.mjs` | `estimateTokens` (4) | mục 5 |
| Bộ nén đầu ra | `src/lib/compress.mjs` | `compress` (72); regex `NOISE` (9), `PASS` (25), `LIB_FRAME` (39), `ERROR` (49), `LOCATION` (60) | mục 6 |
| Chạy lệnh | `src/lib/run.mjs` | `runCommand` (33), `spawnIn` (24), `joinArgs` (10) | mục 8.1 |
| Kiểm tra | `src/lib/verify.mjs` | `findProjects` (41), `detectChecks` (101), `verify` (117) | mục 8.2 |
| Luật lệnh | `src/lib/rules.mjs` | `classifyCommand` (59), `checkWrapped` (50), `wrapCommand` (41), `blockedPath` (76); `VERBOSE` (7), `BOUNDED` (24) | mục 7 |
| Bộ chuyển đổi I/O hook | `src/lib/hookio.mjs` | `normalize` (19), `emitDeny` (37), `emitRewrite` (47), `emitResult` (54), `logEvent` (58), `commandMode` (80), `runHook` (88) | mục 3.3 |
| Hook guard | `src/hooks/guard.mjs` | hàm callback của `runHook` (43), `diffTooLarge` (25), `sizeKB` (17) | mục 4.3 |
| Hook post | `src/hooks/post.mjs` | hàm callback của `runHook` (23), `headTail` (17) | mục 4.4 |
| Hook prompt | `src/hooks/prompt.mjs` | hàm callback của `runHook` (23), `emitContext` (16) | mục 4.2 |
| Hook session | `src/hooks/session.mjs` | hàm callback của `runHook` (10) | mục 4.1 |
| Repo map | `src/lib/repomap.mjs` | `extractSymbols` (81), `listFiles` (117), `sourceFiles` (168), `buildMap` (178), `buildOverview` (215), `mapIsStale` (242), `writeMap` (261), `findSymbol` (280); `LANGS` (21) | mục 9 |
| Gợi ý vị trí | `src/lib/locate.mjs` | `extractCues` (84), `locate` (103), `formatHints` (187), `stem` (44); `STOP` (10), `GENERIC_PATH` (26), `SUFFIXES` (39) | mục 10 |
| TaskSpec | `src/lib/spec.mjs` | `parseSpec` (46), `expandSpec` (70); `VERBS` (7), `FLAG_DEFS` (20) | mục 11 |
| Kiểm toán ngân sách | `src/lib/budget.mjs` | `audit` (62), `lint` (43), `parseFrontmatter` (12), `formatAudit` (144) | mục 12 |
| Báo cáo | `src/lib/report.mjs` | `report` (13) | mục 13.1 |
| Dữ liệu sử dụng VS Code | `src/lib/usage.mjs` | `findWorkspaceStorage` (28), `summarizeSession` (44), `debugLogStats` (123), `usageReport` (151), `formatCompare` (173) | mục 13.2 |
| Cài đặt và gỡ bỏ | `src/lib/install.mjs` | `install` (32), `mergeBlock` (25), `uninstall` (123); `START`/`END` (8) | mục 14 |
| Kiểm tra sức khỏe | `src/lib/doctor.mjs` | `doctor` (14) | mục 15 |
| Cấu hình | `src/lib/config.mjs` | `DEFAULTS`, `loadConfig` (71), `merge` (63), `KIT_DIR` | mọi tham số đều nằm ở đây |
| Đăng ký hook | `templates/.github/hooks/tokenkit.json` | bốn sự kiện | mẫu dòng lệnh fail-open |
| Chỉ dẫn cho agent | `templates/.github/copilot-instructions.md` | khối được đánh dấu | luôn bật, khoảng 324 token |
| Skills | `templates/.github/skills/*/SKILL.md` | `lean-explore`, `lean-verify` | nạp khi liên quan |
| Kiểm thử | `test/*.test.mjs` | `node --test "test/*.test.mjs"` | 57 test, tất cả pass tại thời điểm viết |

### Tham chiếu cấu hình (từ `config.mjs`)

| Khóa | Mặc định | Dùng bởi | Tác dụng |
|---|---|---|---|
| `run.maxLines` | 80 | `compress` | giới hạn số dòng đầu, cuối và ngữ cảnh khi thất bại |
| `run.maxErrorLines` | 150 | `compress` | ngân sách riêng cho dòng lỗi và vị trí `file:line` của chúng |
| `run.headLines` / `tailLines` | 6 / 20 | `compress` | số hàng giữ ở đầu và cuối khi thất bại |
| `run.successTail` | 8 | `compress` | phần cuối giữ khi thành công (giới hạn là gấp đôi giá trị này) |
| `run.context` | 2 | `compress` | số dòng giữ quanh mỗi dòng lỗi |
| `run.timeoutSec` | 0 | `runCommand` | 0 nghĩa là không có thời gian chờ |
| `run.keepLogs` | 10 | `runCommand` | số log chạy được giữ |
| `run.noise` / `run.errors` | `[]` | `compress` | regex riêng của dự án |
| `guard.commands` | `auto` | guard | `auto`, `rewrite`, `deny`, hoặc `off` |
| `guard.reads` / `bounded` | `deny` | guard | `deny` hoặc `off` |
| `guard.shell` | `auto` | guard | shell dùng cho lệnh đã viết lại |
| `guard.maxReadKB` | 48 | guard | giới hạn đọc cả tệp khi không có khoảng dòng |
| `guard.blockPaths` / `allowPaths` | xem `config.mjs` | `blockedPath` | mẫu đường dẫn bị chặn và được miễn |
| `post.minTokens` | 1500 | hook post | ngưỡng kích thước đầu ra để nén (CLI) |
| `post.otherHead` / `otherTail` | 60 / 15 | hook post | phần đầu và cuối cho đầu ra không phải shell |
| `prompt.hints` | `on` | hook prompt | `on` hoặc `off` |
| `prompt.maxHints` | 5 | `locate` | số gợi ý mỗi prompt |
| `prompt.minScore` | 5 | `locate` | ngưỡng sàn cho gợi ý (10 = đúng tên, 8 = hai từ, 5 = một từ khớp toàn bộ tên) |
| `map.maxTokens` | 4000 | `buildMap` | vượt mức này thì map chỉ để grep và `areas.md` được ghi trong ngân sách này |
| `map.maxAgeMinutes` | 60 | `mapIsStale` | giới hạn tuổi của map |
| `map.maxFileKB` | 256 | `buildMap` | tệp lớn hơn chỉ được liệt kê đường dẫn |
| `map.exclude` | `[]` | `sourceFiles` | regex cho các tệp cần bỏ qua |
| `verify.checks` | `[]` | `detectChecks` | các kiểm tra `{ label, cwd, cmd }` tường minh, thay thế việc dò tìm |
| `budget.alwaysOnTokens` | 1200 | `audit` | ngân sách luôn bật |
| `budget.skillDescriptionChars` | 300 | `audit` | giới hạn mô tả skill |

---

## 19. Thuật ngữ

- **Bước** (hay lần gọi mô hình): một vòng trao đổi trong đó harness gửi toàn bộ ngữ cảnh và mô hình trả lời bằng văn bản hoặc lệnh gọi công cụ.
- **Lượt** (turn): một yêu cầu của người dùng, có thể gồm nhiều bước.
- **Ngữ cảnh** (context): mọi thứ gửi cho mô hình ở một bước: chỉ dẫn, định nghĩa công cụ, hội thoại, và kết quả công cụ.
- **Prompt cache**: việc nhà cung cấp tái sử dụng phần đầu prompt giống hệt với giá thấp hơn. Bất cứ thứ gì thay đổi phần đầu prompt sẽ làm mất cache của mọi phần phía sau.
- **Chi phí cố định** (fixed overhead): phần ngữ cảnh được gửi ở mọi bước bất kể tác vụ (chỉ dẫn hệ thống và định nghĩa công cụ).
- **Mất mát trong ngữ cảnh, không mất mát trên đĩa**: nguyên tắc rằng đầu ra đã nén được hiển thị cho mô hình, còn đầu ra đầy đủ được giữ trong tệp log.
- **Hook**: một script mà harness chạy tại một sự kiện trong vòng đời. tokenkit có bốn hook.
- **Fail open**: lỗi của hook không được chặn agent, nên hook thoát với mã 0.
- **Viết lại** (rewrite): thay đổi đối số của một lệnh gọi công cụ trước khi nó chạy. Hộp thoại duyệt khi đó hiển thị lệnh gọi đã viết lại.
- **Wrapper**: dạng `tk run … -- <cmd>` mà một lệnh đã viết lại mang.
- **Repo map**: chỉ mục ký hiệu mỗi tệp một dòng trong `.tokenkit/repomap.md`.
- **Bản tổng quan thư mục** (folder overview): `.tokenkit/areas.md`, được ghi khi repo map vượt ngân sách token, để agent thấy các khu vực của repo mà không cần đọc map.
- **Cue**: một phần của prompt dùng để khớp (định danh, đường dẫn, từ, hoặc cặp từ ghép).
- **Gốc từ** (stem): phần gốc của một từ sau khi bỏ hậu tố nhẹ, để `applied` khớp với `apply`.
- **Gợi ý** (hint): một dòng "hãy bắt đầu đọc ở đây" được thêm vào prompt.
- **TaskSpec**: ký pháp một dòng cho động từ, phạm vi, ràng buộc và dạng đầu ra.
- **Manifest**: `.tokenkit/manifest.json`, bản ghi hash của mỗi tệp mà tokenkit đã ghi.
- **Luôn bật** (always-on): văn bản được gửi cùng mọi yêu cầu.
- **Theo yêu cầu** (on demand): văn bản chỉ được nạp khi mô hình quyết định là liên quan.
