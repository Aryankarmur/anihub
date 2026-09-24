import { BrowserRouter, Route, Routes } from "react-router-dom";
import Navbar from "./component/Navbar";
import Footer from "./component/Footer";
import Home from "./pages/Home";
import Search from "./pages/Search";
import Animeinfo, { Characters, Overview, Relations, Staff } from "./pages/Animeinfo";
import "./App.css";
import Catalogs from "./pages/Catalogs";
import CatAllAnime from "./pages/CatAllAnime";
import Login from "./pages/Login";
import Register from "./pages/Register";
import ForgotPassword from "./pages/ForgotPassword";
import MyLibrary from "./pages/MyLibrary";
import Profile from "./pages/Profile";
import { AuthProvider } from "./context/AuthContext";

const App = () => {
  return (
    <>
    <AuthProvider>
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
          <Route path="/catalog" element={<Catalogs/>}/>
          <Route path="/allanime/:anime" element={<CatAllAnime/>}/>
          <Route path="/library" element={<MyLibrary />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
        </Routes>
        <Footer />
      </BrowserRouter>
    </AuthProvider>
    </>
  );
};

export default App;
