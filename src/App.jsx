import { useState } from 'react'

import './App.css'

import Vibration_Isolation from './components/Vibratio_Isolation'

function App() {
  const [count, setCount] = useState(0)

  return (
    <>
      
      <Vibration_Isolation />

    </>
  )
}

export default App
