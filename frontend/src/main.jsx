import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import '@fontsource/inter'
import '@fortawesome/fontawesome-free/css/all.min.css'
import './index.css'
import Layout from './Layout.jsx'
import AnalyzePage from './Analyze.jsx'
import LichessPgnsPage from './pages/LichessPgnsPage.jsx'
import LichessPgnGamePage from './pages/LichessPgnGamePage.jsx'
import CustomGamePage from './pages/CustomGamePage.jsx'
import TestPage from './pages/TestPage.jsx'

const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      {
        index: true,
        element: <AnalyzePage />
      },
      {
        path: 'analyze',
        element: <AnalyzePage />
      },
      {
        path: 'lichess_pgns',
        children: [
          { index: true, element: <LichessPgnsPage /> },
          { path: ':gameId', element: <LichessPgnGamePage /> },
        ],
      },
      {
        path: 'custom_game',
        element: <CustomGamePage />,
      },
      {
        path: 'test',
        element: <TestPage />,
      },
    ]
  }
])

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
