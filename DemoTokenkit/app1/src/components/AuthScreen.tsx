import { useState, type FormEvent } from 'react'
import { ArrowRight, CheckCheck, Eye, EyeOff, LockKeyhole, Mail, UserRound } from 'lucide-react'
import { authenticate, type AuthSession } from '../lib/api'

interface AuthScreenProps {
  onAuthenticated: (session: AuthSession) => void
}

export default function AuthScreen({ onAuthenticated }: AuthScreenProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setIsSubmitting(true)
    try {
      const session = await authenticate(mode, { email, password, ...(mode === 'register' ? { displayName } : {}) })
      onAuthenticated(session)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Đã có lỗi xảy ra. Vui lòng thử lại.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-ambient auth-ambient-one" />
      <div className="auth-ambient auth-ambient-two" />
      <section className="auth-story">
        <a className="brand auth-brand" href="#home">
          <span className="brand-mark"><CheckCheck size={19} strokeWidth={2.6} /></span>
          <span>việc nhỏ<span className="brand-period">.</span></span>
        </a>
        <div className="auth-story-copy">
          <p className="eyebrow"><span className="eyebrow-line" />MỘT NGÀY CÓ CHỦ ĐÍCH</p>
          <h1>Điều lớn lao<br />bắt đầu từ <span>việc nhỏ.</span></h1>
          <p>Gom những điều cần làm vào một nơi. Tập trung vào từng bước, rồi nhìn lại bạn đã đi xa đến đâu.</p>
        </div>
        <div className="auth-story-foot"><span className="auth-orbit"><span /></span><span>Không gian của riêng bạn<br /><strong>riêng tư · gọn gàng · bình yên</strong></span></div>
      </section>

      <section className="auth-panel-wrap">
        <div className="auth-panel">
          <div className="auth-panel-heading">
            <p className="eyebrow"><span className="eyebrow-line" />{mode === 'login' ? 'CHÀO MỪNG TRỞ LẠI' : 'BẮT ĐẦU HÀNH TRÌNH'}</p>
            <h2>{mode === 'login' ? 'Đăng nhập' : 'Tạo tài khoản'}</h2>
            <p>{mode === 'login' ? 'Tiếp tục ngày của bạn, từng việc một.' : 'Tạo không gian riêng cho những việc quan trọng.'}</p>
          </div>

          <form className="auth-form" onSubmit={submit}>
            {mode === 'register' && <label className="auth-field"><span>Tên của bạn</span><div className="auth-input-wrap"><UserRound size={16} /><input autoComplete="name" required maxLength={70} value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Ví dụ: Minh Anh" /></div></label>}
            <label className="auth-field"><span>Email</span><div className="auth-input-wrap"><Mail size={16} /><input type="email" autoComplete="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="ban@email.com" /></div></label>
            <label className="auth-field"><span>Mật khẩu</span><div className="auth-input-wrap"><LockKeyhole size={16} /><input type={showPassword ? 'text' : 'password'} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required minLength={mode === 'login' ? 1 : 8} maxLength={72} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={mode === 'login' ? 'Nhập mật khẩu của bạn' : 'Ít nhất 8 ký tự'} /><button className="password-toggle" type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></div></label>
            {error && <p className="auth-error" role="alert">{error}</p>}
            <button className="auth-submit" type="submit" disabled={isSubmitting}>{isSubmitting ? 'Đang xử lý...' : mode === 'login' ? 'Đăng nhập' : 'Tạo tài khoản'}<ArrowRight size={17} /></button>
          </form>

          <div className="auth-switch">{mode === 'login' ? 'Chưa có tài khoản?' : 'Đã có tài khoản?'} <button onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError('') }}>{mode === 'login' ? 'Đăng ký' : 'Đăng nhập'}</button></div>
          <div className="auth-private"><LockKeyhole size={13} /> Mật khẩu được mã hóa. Dữ liệu chỉ thuộc về bạn.</div>
        </div>
      </section>
    </main>
  )
}