import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ArrowRight, ArrowLeft } from 'lucide-react';
import Button from '../components/ui/Button';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleLogin = async () => {
    setError(''); setLoading(true);
    try {
      await login(email, pw);
      navigate('/portal');
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed');
    } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-amber-50 via-white to-emerald-50">
      <div className="w-full max-w-md px-4">
        <Link to="/" className="flex items-center gap-3 mb-7">
          <img src="/logo.jpg" alt="Goldenray Energy NZ" className="h-14 w-auto object-contain" />
          <div className="leading-tight">
            <div className="text-base font-extrabold font-display tracking-tight">GOLDENRAY <span className="text-gray-600">ENERGY NZ</span></div>
            <div className="text-[10px] text-gray-400 italic">Powering a Sustainable Future</div>
            <div className="text-[10px] text-amber-600 font-semibold mt-0.5">Employee Portal</div>
          </div>
        </Link>

        <div className="bg-white rounded-2xl p-7 border border-gray-100 shadow-xl shadow-gray-100/50">
          <h2 className="text-xl font-bold font-display mb-5">Sign In</h2>

          {error && <div className="mb-3 px-3 py-2 rounded-lg bg-red-50 text-red-600 text-xs">{error}</div>}

          {[['Email', email, setEmail, 'email'], ['Password', pw, setPw, 'password']].map(([label, val, setter, type]) => (
            <div key={label} className="mb-3">
              <label className="block text-[10px] font-semibold text-gray-400 uppercase mb-1">{label}</label>
              <input type={type} value={val} onChange={e => setter(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm outline-none focus:border-amber-400 transition" />
            </div>
          ))}

          <Button onClick={handleLogin} variant="dark" size="lg" block icon={loading ? undefined : ArrowRight} disabled={loading || !email || !pw}>
            {loading ? 'Signing in...' : 'Sign In'}
          </Button>
        </div>

        <Link to="/" className="flex items-center justify-center gap-1 mt-4 text-xs text-gray-400 hover:text-gray-600">
          <ArrowLeft size={12} /> Back to Website
        </Link>
      </div>
    </div>
  );
}
