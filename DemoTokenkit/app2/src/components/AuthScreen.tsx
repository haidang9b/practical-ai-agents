import { useState, type FormEvent } from 'react';
import { ArrowRight, CheckCheck, LockKeyhole, Mail, ShieldCheck } from 'lucide-react';
import { signIn, signUp, type AuthSession } from '../lib/authApi';

interface AuthScreenProps {
  onAuthenticated: (session: AuthSession) => void;
}

export default function AuthScreen({ onAuthenticated }: AuthScreenProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const session = mode === 'login' ? await signIn(email, password) : await signUp(email, password);
      onAuthenticated(session);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Không thể đăng nhập lúc này.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-frame" aria-label="Đăng nhập Việc Nhỏ">
        <div className="auth-aside">
          <a className="brand auth-brand" href="#login" aria-label="Việc Nhỏ">
            <span className="brand-mark"><CheckCheck size={19} strokeWidth={2.2} /></span>
            <span>việc nhỏ<span className="brand-period">.</span></span>
          </a>
          <div className="auth-aside-copy">
            <span className="auth-kicker">MỘT CHÚT RÕ RÀNG</span>
            <h1>Ngày tốt bắt đầu từ một việc nhỏ.</h1>
            <p>Gom những điều cần làm về một nơi. Rồi bắt đầu từ điều gần nhất.</p>
          </div>
          <div className="auth-aside-bottom"><ShieldCheck size={15} /><span>Công việc của bạn được lưu riêng tư trên thiết bị.</span></div>
          <span className="auth-aside-number">01 <i>/</i> 03</span>
        </div>
        <div className="auth-panel">
          <div className="auth-mobile-brand"><span className="brand-mark"><CheckCheck size={18} /></span><span>việc nhỏ<span className="brand-period">.</span></span></div>
          <div className="auth-heading">
            <span className="eyebrow">{mode === 'login' ? 'CHÀO MỪNG TRỞ LẠI' : 'BẮT ĐẦU TỪ HÔM NAY'}</span>
            <h2>{mode === 'login' ? 'Đăng nhập' : 'Tạo tài khoản'}</h2>
            <p>{mode === 'login' ? 'Tiếp tục với danh sách công việc của bạn.' : 'Tạo không gian riêng cho những việc quan trọng.'}</p>
          </div>

          <div className="auth-tabs" role="tablist" aria-label="Chọn hình thức">
            <button type="button" className={mode === 'login' ? 'is-current' : ''} role="tab" aria-selected={mode === 'login'} onClick={() => { setMode('login'); setError(''); }}>Đăng nhập</button>
            <button type="button" className={mode === 'register' ? 'is-current' : ''} role="tab" aria-selected={mode === 'register'} onClick={() => { setMode('register'); setError(''); }}>Tạo tài khoản</button>
          </div>

          <form className="auth-form" onSubmit={submit}>
            <label className="auth-label" htmlFor="auth-email">Email</label>
            <div className="auth-input-wrap"><Mail size={16} /><input id="auth-email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="ten@vidu.com" required /></div>
            <div className="auth-password-label"><label className="auth-label" htmlFor="auth-password">Mật khẩu</label>{mode === 'register' && <span>Tối thiểu 10 ký tự</span>}</div>
            <div className="auth-input-wrap"><LockKeyhole size={16} /><input id="auth-password" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={mode === 'register' ? 10 : undefined} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Nhập mật khẩu" required /></div>
            {error && <p className="auth-error" role="alert">{error}</p>}
            <button className="auth-submit" type="submit" disabled={submitting}>
              <span>{submitting ? 'Đang xử lý...' : mode === 'login' ? 'Đăng nhập' : 'Tạo tài khoản'}</span><ArrowRight size={17} />
            </button>
          </form>
          <div className="auth-security"><LockKeyhole size={13} /><span>Phiên đăng nhập được bảo vệ bằng token an toàn.</span></div>
        </div>
      </section>
      <footer className="auth-footer"><span>VIỆC NHỎ, NGÀY DÀI</span><span>Không gian làm việc cá nhân</span></footer>
    </main>
  );
}