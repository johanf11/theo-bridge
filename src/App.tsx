import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SearchProvider } from "@/contexts/SearchContext";
import Landing from "./pages/Landing";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Dashboard from "./pages/Dashboard";
import Transactions from "./pages/Transactions";
import Balance from "./pages/Balance";
import Payout from "./pages/Payout";
import Convert from "./pages/Convert";
import Settings from "./pages/Settings";
import OrderStatus from "./pages/OrderStatus";
import Kyb from "./pages/Kyb";
import AdminKyb from "./pages/AdminKyb";
import NotFound from "./pages/NotFound";
import { ProtectedRoute } from "@/components/theo/ProtectedRoute";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <SearchProvider>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
          <Route path="/transactions" element={<ProtectedRoute><Transactions /></ProtectedRoute>} />
          <Route path="/balance" element={<ProtectedRoute><Balance /></ProtectedRoute>} />
          <Route path="/payout" element={<ProtectedRoute><Payout /></ProtectedRoute>} />
          <Route path="/convert" element={<ProtectedRoute><Convert /></ProtectedRoute>} />
          <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
          <Route path="/kyb" element={<ProtectedRoute><Kyb /></ProtectedRoute>} />
          <Route path="/orders/:id" element={<ProtectedRoute><OrderStatus /></ProtectedRoute>} />
          <Route path="/admin/kyb" element={<ProtectedRoute adminOnly><AdminKyb /></ProtectedRoute>} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
    </SearchProvider>
  </QueryClientProvider>
);

export default App;
