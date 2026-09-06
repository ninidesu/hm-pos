import { Navigate, Route, Routes } from 'react-router-dom'
import AuthUiLayer from './components/auth/AuthUiLayer'
import ProtectedRoute from './components/ProtectedRoute'
import AdminDashboard from './pages/AdminDashboard'
import CashierPage from './pages/CashierPage'
import PortalLoginPage from './pages/PortalLoginPage'

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/portal" element={<PortalLoginPage />} />
        <Route
          path="/cashier"
          element={<ProtectedRoute allowedRoles={['cashier']}><CashierPage /></ProtectedRoute>}
        />
        <Route
          path="/admin/*"
          element={<ProtectedRoute allowedRoles={['admin', 'manager']}><AdminDashboard /></ProtectedRoute>}
        />
        <Route path="/" element={<Navigate to="/portal" replace />} />
        <Route path="*" element={<Navigate to="/portal" replace />} />
      </Routes>
      <AuthUiLayer />
    </>
  )
}
