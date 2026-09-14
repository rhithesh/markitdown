import { Navigate, Route, Routes } from "react-router-dom";
import Playground from "./pages/Playground";
import Projects from "./pages/Projects";
import ProjectDetail from "./pages/ProjectDetail";
import Login from "./pages/Login";
import { useAuth } from "./lib/auth";

function App() {
  const { status } = useAuth();

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
      </div>
    );
  }

  if (status === "anon") {
    return <Login />;
  }

  return (
    <Routes>
      <Route path="/playground" element={<Playground />} />
      <Route path="/project" element={<Projects />} />
      <Route path="/project/:id" element={<ProjectDetail />} />
      {/* Legacy /projects redirect */}
      <Route path="/projects" element={<Navigate to="/project" replace />} />
      <Route path="/" element={<Navigate to="/playground" replace />} />
      <Route path="*" element={<Navigate to="/playground" replace />} />
    </Routes>
  );
}

export default App;
