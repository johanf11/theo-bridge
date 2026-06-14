import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SearchProvider } from "@/contexts/SearchContext";
import { LanguageProvider } from "@/contexts/LanguageContext";
import Landing from "./pages/Landing";
import Login from "./pages/Login";
import Register from "./pages/Register";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import Dashboard from "./pages/Dashboard";
import Transactions from "./pages/Transactions";
import Balance from "./pages/Balance";
import Payout from "./pages/Payout";
import Convert from "./pages/Convert";
import Settings from "./pages/Settings";
import OrderStatus from "./pages/OrderStatus";
import Kyb from "./pages/Kyb";
import AdminKyb from "./pages/AdminKyb";
import AdminConversions from "./pages/AdminConversions";
import AdminTools from "./pages/AdminTools";
import AdminLedger from "./pages/AdminLedger";
import AdminTransactions from "./pages/AdminTransactions";
import Compliance from "./pages/Compliance";
import Billing from "./pages/Billing";
import Invoices from "./pages/Invoices";
import InvoiceView from "./pages/InvoiceView";
import NotFound from "./pages/NotFound";
import { ProtectedRoute } from "@/components/theo/ProtectedRoute";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <LanguageProvider>
    <SearchProvider>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
          <Route path="/transactions" element={<ProtectedRoute><Transactions /></ProtectedRoute>} />
          <Route path="/balance" element={<ProtectedRoute><Balance /></ProtectedRoute>} />
          <Route path="/payout" element={<ProtectedRoute><Payout /></ProtectedRoute>} />
          <Route path="/invoices" element={<ProtectedRoute><Invoices /></ProtectedRoute>} />
          <Route path="/inv/:token" element={<InvoiceView />} />
          <Route path="/convert" element={<ProtectedRoute><Convert /></ProtectedRoute>} />
          <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
          <Route path="/kyb" element={<ProtectedRoute><Kyb /></ProtectedRoute>} />
          <Route path="/orders/:id" element={<ProtectedRoute><OrderStatus /></ProtectedRoute>} />
          <Route path="/admin/kyb" element={<ProtectedRoute adminOnly><AdminKyb /></ProtectedRoute>} />
          <Route path="/admin/conversions" element={<ProtectedRoute adminOnly><AdminConversions /></ProtectedRoute>} />
          <Route path="/admin/tools" element={<ProtectedRoute adminOnly><AdminTools /></ProtectedRoute>} />
          <Route path="/admin/ledger" element={<ProtectedRoute adminOnly><AdminLedger /></ProtectedRoute>} />
          <Route path="/admin/transactions" element={<ProtectedRoute adminOnly><AdminTransactions /></ProtectedRoute>} />
          <Route path="/compliance" element={<ProtectedRoute><Compliance /></ProtectedRoute>} />
          <Route path="/billing" element={<ProtectedRoute><Billing /></ProtectedRoute>} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
    </SearchProvider>
    </LanguageProvider>
  </QueryClientProvider>
);

export default App;
