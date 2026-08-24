import { Navigate, Route, Routes } from "react-router-dom";
import Playground from "./pages/Playground";

function App() {
  return (
    <Routes>
      <Route path="/playground" element={<Playground />} />
      <Route path="/" element={<Navigate to="/playground" replace />} />
    </Routes>
  );
}

export default App;
