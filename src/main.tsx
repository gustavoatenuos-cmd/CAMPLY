import React from 'react';
import { createRoot } from 'react-dom/client';
import { MotionConfig } from 'framer-motion';
import App from './App';
import './styles.css';

const root = document.getElementById('root');

if (!root) {
  throw new Error('Elemento root não encontrado.');
}

createRoot(root).render(
  <React.StrictMode>
    {/* reducedMotion="user": animações do Framer respeitam a preferência de
        acessibilidade do sistema operacional (prefers-reduced-motion). */}
    <MotionConfig reducedMotion="user">
      <App />
    </MotionConfig>
  </React.StrictMode>,
);
