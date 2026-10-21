using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Threading;
using System.Runtime.InteropServices;
using System.Web.Script.Serialization;
using System.Windows.Forms;
internal static class InsertionSmoke {
    static Form Window; static TextBox Edit; static Process Helper; static JavaScriptSerializer Json=new JavaScriptSerializer();
    static Dictionary<string,object> Request(int id,string op,Dictionary<string,object> extra=null) {
        var d=extra??new Dictionary<string,object>(); d["id"]=id; d["op"]=op; Helper.StandardInput.WriteLine(Json.Serialize(d));
        string line; while ((line=Helper.StandardOutput.ReadLine())!=null) { var r=Json.Deserialize<Dictionary<string,object>>(line); if (r.ContainsKey("id")&&Convert.ToInt32(r["id"])==id) return r; }
        throw new Exception("Helper exited before response.");
    }
    static T UI<T>(Func<T> action) { return (T)Window.Invoke(action); }
    [STAThread] static void Main(string[] args) {
        Window=new Form { Text="Willfull isolated insertion verification",Width=480,Height=180,StartPosition=FormStartPosition.CenterScreen,TopMost=true };
        Edit=new TextBox { Multiline=true,Dock=DockStyle.Fill,Text="prefix SELECT suffix" }; Window.Controls.Add(Edit);
        Window.Shown+=delegate {
            uint pid; uint other=GetWindowThreadProcessId(GetForegroundWindow(),out pid), own=GetCurrentThreadId();
            bool attached=other!=own&&AttachThreadInput(own,other,true);
            try { SetForegroundWindow(Window.Handle); Window.Activate(); Edit.Focus(); Edit.Select(7,6); }
            finally { if (attached) AttachThreadInput(own,other,false); }
            new Thread(Test) { IsBackground=true }.Start();
        };
        Application.Run(Window);
    }
    static void Test() {
        try {
            Thread.Sleep(200);
            var psi=new ProcessStartInfo("F:\\Willfull\\native\\windows\\bin\\Willfull.Native.exe") { UseShellExecute=false,CreateNoWindow=true,RedirectStandardInput=true,RedirectStandardOutput=true,RedirectStandardError=true };
            Helper=Process.Start(psi); Helper.StandardOutput.ReadLine();
            var response=Request(1,"focus"); var target=(Dictionary<string,object>)response["result"];
            if (Convert.ToInt32(target["pid"])!=Process.GetCurrentProcess().Id) throw new Exception("Scratch fixture did not acquire foreground; no paste attempted.");
            if (!target.ContainsKey("selectionStart")||Convert.ToInt32(target["selectionStart"])!=7) throw new Exception("Native caret/selection detection failed.");
            string oldClipboard=UI(delegate { return Clipboard.ContainsText()?Clipboard.GetText():null; });
            var pasted=Request(2,"paste",new Dictionary<string,object> { {"target",target},{"text","Willfull native test"} });
            Thread.Sleep(100);
            string actual=UI(delegate { return Edit.Text; });
            if (!Convert.ToBoolean(pasted["ok"])||actual!="prefix Willfull native test suffix") throw new Exception("Real insertion failed: "+Json.Serialize(pasted));
            bool restored=UI(delegate { return oldClipboard==null?!Clipboard.ContainsText():Clipboard.GetText()==oldClipboard; });
            response=Request(3,"focus"); target=(Dictionary<string,object>)response["result"];
            UI(delegate { Edit.Select(0,0); return true; });
            var rejected=Request(4,"paste",new Dictionary<string,object> { {"target",target},{"text","MUST NOT INSERT"} });
            if (Convert.ToBoolean(rejected["ok"])) throw new Exception("Changed-caret guard failed.");
            Console.WriteLine(Json.Serialize(new { passed=true,realSelectionReplacement=true,clipboardTextRestored=restored,changedCaretRejected=true }));
            Request(5,"shutdown"); Helper.WaitForExit(2000);
        } catch (Exception ex) { Console.WriteLine(Json.Serialize(new { passed=false,error=ex.Message })); Environment.ExitCode=1; }
        finally { if (Helper!=null&&!Helper.HasExited) Helper.Kill(); Window.BeginInvoke((Action)delegate { Window.Close(); }); }
    }
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd,out uint pid);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] static extern bool AttachThreadInput(uint from,uint to,bool attach);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hwnd);
}
