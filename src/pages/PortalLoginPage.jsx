import {
  ArrowRight,
  CircleAlert,
  Eye,
  EyeOff,
  LoaderCircle,
  LockKeyhole,
  ShieldCheck,
  UserRound,
} from 'lucide-react'
import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { normalizeRole, roleRoutes, signInPortal } from '../lib/auth'
import { queueAuthWelcome } from '../lib/authFeedback'
import { EMAIL_MAX_LENGTH } from '../utils/inputValidation'
import useStoreInfo from '../hooks/useStoreInfo'

const roleOptions = [
  {
    value: 'admin',
    label: 'Admin / Manager',
    shortLabel: 'Admin',
  },
  {
    value: 'cashier',
    label: 'Cashier',
    shortLabel: 'Cashier',
  },
]

const portalScopeLabel = 'Admin · Point-of-sale · Transactions · Stock Management'

export default function PortalLoginPage() {
  const storeInfo = useStoreInfo()
  const [role, setRole] = useState('admin')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const navigate = useNavigate()
  const location = useLocation()
  const selectedRole = roleOptions.find((option) => option.value === role) || roleOptions[0]

  function selectRole(nextRole) {
    setRole(nextRole)
    setMessage('')
  }

  async function submit(event) {
    event.preventDefault()
    setMessage('')
    setLoading(true)
    const form = new FormData(event.currentTarget)
    const identifier = String(form.get('identifier') || '').trim()
    const password = String(form.get('password') || '')

    try {
      const { profile } = await signInPortal({ identifier, password, role })
      const normalizedRole = normalizeRole(profile.role || role)
      const target = location.state?.from || roleRoutes[normalizedRole] || roleRoutes[role] || '/portal'
      queueAuthWelcome(profile, { storeName: storeInfo.name })
      navigate(target, { replace: true })
    } catch (error) {
      setMessage(error.message || 'Unable to sign in. Check your credentials and selected access level.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="staff-portal">
      <section className="staff-portal__brand-panel" aria-label={`${storeInfo.name || 'HM POS'} staff portal`}>
        <span className="staff-portal__secure-label"><LockKeyhole size={15} aria-hidden="true" /> Secure access</span>

        <div className="staff-portal__brand-focus">
          <a className="staff-portal__brand" href="/portal" aria-label={`${storeInfo.name || 'HM POS'} staff portal`}>
            {storeInfo.logoUrl ? <img className="staff-portal__brand-logo" src={storeInfo.logoUrl} alt=""/> : null}
            <span>
              <strong>{storeInfo.name || 'HM POS'}</strong>
              <small>{portalScopeLabel}</small>
            </span>
          </a>
        </div>

        <footer className="staff-portal__brand-footer">
          <span><ShieldCheck size={16} aria-hidden="true" /> Authorized staff only</span>
          <small>© {new Date().getFullYear()} {storeInfo.name || 'HM POS'}. All rights reserved.</small>
        </footer>
      </section>

      <section className="staff-portal__form-panel" aria-labelledby="staff-login-title">
        <div className="staff-portal__mobile-brand">
          {storeInfo.logoUrl ? <img className="staff-portal__mobile-logo" src={storeInfo.logoUrl} alt=""/> : null}<span><strong>{storeInfo.name || 'HM POS'}</strong><small>{portalScopeLabel}</small></span>
        </div>

        <div className="staff-portal__form-wrap">
          <div className="staff-portal__form-header">
            <span className="staff-portal__form-kicker">Internal staff access</span>
            <h2 id="staff-login-title">Sign in to your workspace</h2>
          </div>

          <form className="staff-portal__form" onSubmit={submit} aria-busy={loading} autoComplete="on">
            <fieldset className="staff-portal__role-fieldset">
              <legend>Access level</legend>
              <div className="staff-portal__roles">
                {roleOptions.map(({ value, label }) => {
                  const active = role === value
                  return (
                    <button
                      className={`staff-portal__role-option${active ? ' is-active' : ''}`}
                      key={value}
                      type="button"
                      aria-pressed={active}
                      disabled={loading}
                      onClick={() => selectRole(value)}
                    >
                      <span className="staff-portal__role-copy"><strong>{label}</strong></span>
                      <span className="staff-portal__role-check" aria-hidden="true" />
                    </button>
                  )
                })}
              </div>
            </fieldset>

            <div className="staff-portal__field">
              <label className="staff-portal__field-label" htmlFor="portal-identifier">Email or username</label>
              <span className="staff-portal__input-wrap">
                <UserRound size={18} aria-hidden="true" />
                <input
                  id="portal-identifier"
                  name="identifier"
                  type="text"
                  maxLength={EMAIL_MAX_LENGTH}
                  placeholder="Enter email or username"
                  required
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck="false"
                />
              </span>
            </div>

            <div className="staff-portal__field">
              <label className="staff-portal__field-label" htmlFor="portal-password">Password</label>
              <span className="staff-portal__input-wrap">
                <LockKeyhole size={18} aria-hidden="true" />
                <input
                  id="portal-password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  minLength="8"
                  maxLength="12"
                  placeholder="Enter your password"
                  required
                  autoComplete="current-password"
                />
                <button
                  className="staff-portal__password-toggle"
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                >
                  {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
                </button>
              </span>
            </div>

            {message ? <p className="staff-portal__message" id="portal-login-message" role="alert"><span><CircleAlert size={16} aria-hidden="true" /></span>{message}</p> : null}

            <button className="staff-portal__submit" type="submit" disabled={loading}>
              {loading ? <><LoaderCircle className="staff-portal__spin" size={18} aria-hidden="true" /><span>Signing you in</span></> : <><span>Continue as {selectedRole.shortLabel}</span><ArrowRight size={18} aria-hidden="true" /></>}
            </button>
          </form>

          <p className="staff-portal__form-help">Need access help? Contact your administrator.</p>
        </div>

        <footer className="staff-portal__mobile-footer"><span><ShieldCheck size={15} aria-hidden="true" /> Authorized staff only</span><small>© {new Date().getFullYear()} {storeInfo.name || 'HM POS'}</small></footer>
      </section>
    </main>
  )
}
