import { C } from './Widgets'
import { Modal, Button } from './ui'

export default function LogoutModal({ show, onConfirm, onCancel }) {
  return (
    <Modal
      open={!!show}
      onClose={onCancel}
      width={360}
      icon="offline" iconColor={C.red}
      title="Log out?"
      sub="You'll need to sign in again to get back to your dashboard."
      footer={
        <>
          <Button variant="ghost" full onClick={onCancel}>Stay signed in</Button>
          <Button variant="danger" full onClick={onConfirm}>Log out</Button>
        </>
      }
    />
  )
}
