import { Navigate, Route, Routes } from "react-router-dom";
import Playground from "./pages/Playground";
import Projects from "./pages/Projects";
import ProjectDetail from "./pages/ProjectDetail";

function App() {
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
