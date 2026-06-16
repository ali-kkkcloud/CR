import { useEffect } from 'react'
import { useRouter } from 'next/router'
export default function Home() {
  const router = useRouter()
  useEffect(() => { router.replace('/login') }, [])
  return (
    <div style={{display:'flex',alignItems:'center',justifyContent:'center',minHeight:'100vh'}}>
      <div className="spinner"></div>
    </div>
  )
}
