import { BrowserRouter, Route, Routes } from "react-router-dom";
import Navbar from "./component/Navbar";
import Home from "./pages/Home";
import Search from "./pages/Search";
import Animeinfo, { Characters, Overview, Relations, Staff } from "./pages/Animeinfo";
import "./App.css";

const App = () => {
  return (
    <>
      <BrowserRouter>
        <Navbar />
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/anime/:id" element={<Animeinfo />}>
            <Route index element={<Overview />} />
            <Route path="relations" element={<Relations />} />
            <Route path="characters" element={<Characters />} />
            <Route path="staff" element={<Staff />} />
          </Route>
          <Route path="/search" element={<Search/>}/>
        </Routes>
      </BrowserRouter>
    </>
  );
};

export default App;
