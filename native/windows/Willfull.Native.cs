using System;
using System.Collections.Generic;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Automation;
using System.Windows.Automation.Text;
using System.Windows.Forms;

namespace Willfull.Native {
internal static class Program {
    static readonly BlockingCollection<object> Output = new BlockingCollection<object>(256);
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 4 * 1024 * 1024 };
    static readonly BlockingCollection<Action> HotkeyQueue = new BlockingCollection<Action>(64);
    static Control Dispatcher;
    static AudioCapture Audio;
    static KeyboardHook Keys;
    static DeviceMonitor DeviceNotifications;
    static volatile bool Running = true;
    internal static volatile bool SessionActive;
    internal static volatile bool InteractionActive;
    static string ActiveSession;

    internal static Dictionary<string, object> Obj(params object[] values) {
        var result = new Dictionary<string, object>();
        for (int i = 0; i < values.Length; i += 2) result[(string)values[i]] = values[i + 1];
        return result;
    }
    internal static bool Emit(object value) { return Output.TryAdd(value); }
    static void Reply(object id, object value) { Output.Add(Obj("id", id, "ok", true, "result", value)); }
    static void Fail(object id, string message) { Output.Add(Obj("id", id, "ok", false, "error", message)); }
    static string Str(Dictionary<string, object> d, string key, string fallback = "") { object value; return d.TryGetValue(key, out value) && value != null ? Convert.ToString(value) : fallback; }
    static long Num(Dictionary<string, object> d, string key, long fallback = 0) { object value; long n; return d.TryGetValue(key, out value) && value != null && Int64.TryParse(Convert.ToString(value), out n) ? n : fallback; }

    [STAThread]
    static void Main() {
        Console.InputEncoding = new UTF8Encoding(false);
        Console.OutputEncoding = new UTF8Encoding(false);
        var writer = new Thread(delegate() {
            var serializer = new JavaScriptSerializer { MaxJsonLength = 4 * 1024 * 1024 };
            try { foreach (object item in Output.GetConsumingEnumerable()) Console.WriteLine(serializer.Serialize(item)); }
            catch { Running = false; Environment.Exit(0); }
        });
        writer.IsBackground = true; writer.Name = "Willfull JSON output"; writer.Start();
        Application.EnableVisualStyles();
        Dispatcher = new Control(); IntPtr ignored = Dispatcher.Handle;
        DeviceNotifications = new DeviceMonitor();
        var hotkeys = new Thread(delegate() { foreach (Action action in HotkeyQueue.GetConsumingEnumerable()) action(); });
        hotkeys.IsBackground = true; hotkeys.Name = "Willfull ordered hotkey events"; hotkeys.Start();
        Keys = new KeyboardHook(); Keys.Start();
        var reader = new Thread(delegate() {
            string line;
            while (Running && (line = Console.ReadLine()) != null) {
                if (line.Length > 4 * 1024 * 1024) { Fail(null, "Command exceeds 4 MiB."); continue; }
                try {
                    var command = Json.Deserialize<Dictionary<string, object>>(line);
                    Dispatcher.BeginInvoke((Action)(delegate() { Execute(command); }));
                } catch (Exception ex) { Fail(null, "Invalid JSON: " + ex.Message); }
            }
            if (Running) try { Dispatcher.BeginInvoke((Action)Shutdown); } catch { }
        });
        reader.IsBackground = true; reader.Name = "Willfull command input"; reader.Start();
        Emit(Obj("event", "ready", "protocol", 1, "audioBackend", "winmm", "sampleRate", 16000, "channels", 1, "hotkeys", Keys.Description()));
        Application.Run();
        Running = false;
        try { if (Audio != null) Audio.Dispose(); } catch { }
        Keys.Dispose();
        DeviceNotifications.Dispose();
        Output.CompleteAdding(); writer.Join(500);
    }

    static void Execute(Dictionary<string, object> command) {
        object id = command.ContainsKey("id") ? command["id"] : null;
        try {
            string op = Str(command, "op");
            if (op == "devices") Reply(id, AudioCapture.Devices());
            else if (op == "busy") {
                object active;
                if(!command.TryGetValue("active",out active)||!(active is bool)) throw new InvalidOperationException("busy requires an active boolean.");
                InteractionActive=(bool)active; Reply(id,Obj("active",InteractionActive));
            }
            else if (op == "metrics") {
                var pids=command.ContainsKey("pids")?command["pids"] as System.Collections.IEnumerable:null;
                var items=new List<object>(); var seen=new HashSet<int>(); long working=0,privateBytes=0;
                if(pids!=null) foreach(object rawPid in pids) {
                    int pid; if(!Int32.TryParse(Convert.ToString(rawPid),out pid)||pid<=0||!seen.Add(pid)) continue;
                    if(seen.Count>64) throw new InvalidOperationException("Metrics accepts at most 64 process IDs.");
                    try { using(var process=Process.GetProcessById(pid)) { process.Refresh(); working+=process.WorkingSet64; privateBytes+=process.PrivateMemorySize64; items.Add(Obj("pid",pid,"name",process.ProcessName,"workingSetBytes",process.WorkingSet64,"privateBytes",process.PrivateMemorySize64)); } }
                    catch { items.Add(Obj("pid",pid,"unavailable",true)); }
                }
                Reply(id,Obj("workingSetBytes",working,"privateBytes",privateBytes,"byPid",items,"timestamp",DateTime.UtcNow.ToString("o")));
            }
            else if (op == "focus" || op == "selection") {
                var target = FocusSnapshot.Capture(IntPtr.Zero);
                Reply(id, op == "selection" ? Obj("text", target["selectionText"], "target", target, "available", target["selectionAvailable"]) : target);
            } else if (op == "configure") {
                if (SessionActive) throw new InvalidOperationException("Cannot change shortcuts while recording.");
                Reply(id, Obj("hotkeys", Keys.Configure(command)));
            } else if (op == "start") {
                if (Audio != null || SessionActive) throw new InvalidOperationException("A recording session is already active.");
                ActiveSession = Str(command, "sessionId", Guid.NewGuid().ToString("N"));
                int deviceId = (int)Num(command, "deviceId", -1);
                Audio = new AudioCapture(ActiveSession, deviceId);
                try { Audio.Start(); SessionActive = true; }
                catch { Audio.Dispose(); Audio = null; ActiveSession = null; throw; }
                Reply(id, Obj("sessionId", ActiveSession, "captureReady", true, "sampleRate", 16000, "channels", 1, "format", "s16le", "backend", "winmm"));
            } else if (op == "stop" || op == "cancel") {
                string requested = Str(command, "sessionId");
                if (requested.Length > 0 && ActiveSession != null && requested != ActiveSession) throw new InvalidOperationException("Session ID mismatch.");
                string stopped = ActiveSession;
                SessionActive = false;
                if (Audio != null) { Audio.Stop(op == "cancel"); Audio.Dispose(); Audio = null; }
                ActiveSession = null;
                Reply(id, Obj("sessionId", stopped, "stopped", true, "cancelled", op == "cancel"));
            } else if (op == "paste") {
                string text = Str(command, "text");
                if (text.Length == 0 || text.Length > 100000) throw new InvalidOperationException("Paste text must contain 1–100000 characters.");
                var target = command.ContainsKey("target") ? command["target"] as Dictionary<string, object> : null;
                if (target == null) throw new InvalidOperationException("Paste requires a captured target.");
                Reply(id, ClipboardTransaction.Paste(text, target));
            } else if (op == "shutdown") { Reply(id, Obj("stopped", true)); Shutdown(); }
            else throw new InvalidOperationException("Unknown operation: " + op);
        } catch (Exception ex) { Fail(id, ex.GetBaseException().Message); }
    }

    static void Shutdown() {
        Running = false; SessionActive = false; InteractionActive = false;
        if (Audio != null) { Audio.Dispose(); Audio = null; }
        Application.ExitThread();
    }

    internal static void Hotkey(string action, string mode, IntPtr window) {
        HotkeyQueue.TryAdd(delegate {
            try {
                var evt = Obj("event", "hotkey", "action", action, "mode", mode);
                if (action == "down" || action == "toggle" || action == "paste-last") evt["target"] = FocusSnapshot.Capture(window);
                Emit(evt);
            } catch (Exception ex) { Emit(Obj("event", "helper-error", "error", ex.Message)); }
        });
    }
}

internal sealed class KeyboardHook : IDisposable {
    const int WM_KEYDOWN = 0x100, WM_KEYUP = 0x101, WM_SYSKEYDOWN = 0x104, WM_SYSKEYUP = 0x105;
    Thread Worker; uint ThreadId; IntPtr Hook; HookProc Callback;
    bool Ctrl, Alt, Shift, Win, Held; string Mode = "dictate";
    readonly HashSet<uint> Pressed = new HashSet<uint>(), Consumed = new HashSet<uint>();
    volatile Binding[] Bindings = new [] { Binding.Parse("Ctrl+Alt+Space","down","dictate"),Binding.Parse("Ctrl+Alt+Shift+Space","down","command"),Binding.Parse("Ctrl+Alt+Enter","toggle","dictate"),Binding.Parse("Ctrl+Alt+A","apply","command"),Binding.Parse("Ctrl+Alt+V","paste-last","dictate") };
    Binding HeldBinding;
    sealed class Binding {
        internal uint Key; internal bool Ctrl,Alt,Shift,Win; internal string Label,Action,Mode;
        internal static Binding Parse(string label,string action,string mode) {
            if (String.IsNullOrWhiteSpace(label)) throw new InvalidOperationException("A shortcut cannot be empty.");
            var binding=new Binding { Action=action,Mode=mode }; var parts=label.Split('+'); string keyName=null;
            foreach(string item in parts) {
                string part=item.Trim().ToUpperInvariant();
                if (part=="CTRL"||part=="CONTROL") binding.Ctrl=true;
                else if (part=="ALT") binding.Alt=true;
                else if (part=="SHIFT") binding.Shift=true;
                else if (part=="WIN"||part=="SUPER"||part=="META") binding.Win=true;
                else { if (keyName!=null) throw new InvalidOperationException("Use one letter, digit, function key, Space, or Enter per shortcut."); keyName=part; }
            }
            if (!binding.Ctrl&&!binding.Alt&&!binding.Win) throw new InvalidOperationException("Shortcut requires Ctrl, Alt, or Win.");
            if (keyName==null) throw new InvalidOperationException("Shortcut needs a non-modifier key.");
            if (keyName.Length==1&&((keyName[0]>='A'&&keyName[0]<='Z')||(keyName[0]>='0'&&keyName[0]<='9'))) binding.Key=keyName[0];
            else if (keyName=="SPACE") binding.Key=0x20;
            else if (keyName=="ENTER"||keyName=="RETURN") { binding.Key=0x0D; keyName="Enter"; }
            else if (keyName.StartsWith("F")) { int n; if (!Int32.TryParse(keyName.Substring(1),out n)||n<1||n>24) throw new InvalidOperationException("Supported function keys are F1–F24."); binding.Key=(uint)(0x70+n-1); }
            else throw new InvalidOperationException("Unsupported shortcut key: "+keyName);
            if (binding.Win&&binding.Key==0x4C) throw new InvalidOperationException("Win+L is reserved by Windows.");
            binding.Label=(binding.Ctrl?"Ctrl+":"")+(binding.Alt?"Alt+":"")+(binding.Shift?"Shift+":"")+(binding.Win?"Win+":"")+(binding.Key==0x20?"Space":keyName);
            return binding;
        }
        internal bool Matches(uint key,bool ctrl,bool alt,bool shift,bool win) { return Key==key&&Ctrl==ctrl&&Alt==alt&&Shift==shift&&Win==win; }
        internal bool RequiredReleased(bool ctrl,bool alt,bool shift,bool win) { return (Ctrl&&!ctrl)||(Alt&&!alt)||(Shift&&!shift)||(Win&&!win); }
    }
    readonly ManualResetEvent Ready = new ManualResetEvent(false);
    internal object Description() { Binding[] bindings=Bindings; return Program.Obj("dictate",bindings[0].Label,"command",bindings[1].Label,"toggle",bindings[2].Label,"apply",bindings[3].Label,"pasteLast",bindings[4].Label,"cancel","Escape"); }
    internal object Configure(Dictionary<string,object> command) {
        if (Held) throw new InvalidOperationException("Release the active shortcut before configuring shortcuts.");
        Binding[] old=Bindings; var next=(Binding[])old.Clone();
        string[] names=new [] { "hotkey","commandHotkey","toggleHotkey" };
        for(int i=0;i<names.Length;i++) if(command.ContainsKey(names[i])) next[i]=Binding.Parse(Convert.ToString(command[names[i]]),old[i].Action,old[i].Mode);
        for(int i=0;i<next.Length;i++) for(int j=i+1;j<next.Length;j++) if(next[i].Label==next[j].Label) throw new InvalidOperationException("Shortcut conflicts with another Willfull action: "+next[i].Label);
        Bindings=next; return Description();
    }
    internal void Start() {
        Worker = new Thread(delegate() {
            ThreadId = GetCurrentThreadId(); Callback = OnKey;
            foreach(uint key in new uint[] {0xA2,0xA3,0xA4,0xA5,0xA0,0xA1,0x5B,0x5C}) if(Down((int)key)) Pressed.Add(key);
            UpdateModifiers();
            Hook = SetWindowsHookEx(13, Callback, GetModuleHandle(null), 0);
            Ready.Set();
            MSG msg; while (GetMessage(out msg, IntPtr.Zero, 0, 0) > 0) { TranslateMessage(ref msg); DispatchMessage(ref msg); }
            if (Hook != IntPtr.Zero) UnhookWindowsHookEx(Hook);
        });
        Worker.IsBackground = true; Worker.Name = "Willfull keyboard message loop"; Worker.Start();
        if (!Ready.WaitOne(3000) || Hook == IntPtr.Zero) throw new InvalidOperationException("Could not register Windows keyboard hook.");
    }
    static bool Down(int key) { return (GetAsyncKeyState(key) & 0x8000) != 0; }
    void UpdateModifiers() { Ctrl=Pressed.Contains(0x11)||Pressed.Contains(0xA2)||Pressed.Contains(0xA3); Alt=Pressed.Contains(0x12)||Pressed.Contains(0xA4)||Pressed.Contains(0xA5); Shift=Pressed.Contains(0x10)||Pressed.Contains(0xA0)||Pressed.Contains(0xA1); Win=Pressed.Contains(0x5B)||Pressed.Contains(0x5C); }
    IntPtr OnKey(int code, IntPtr wp, IntPtr lp) {
        if (code >= 0) {
            int message = wp.ToInt32(); bool down = message == WM_KEYDOWN || message == WM_SYSKEYDOWN;
            bool up = message == WM_KEYUP || message == WM_SYSKEYUP;
            var key = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lp, typeof(KBDLLHOOKSTRUCT));
            if ((key.flags & 0x10) != 0) return CallNextHookEx(Hook, code, wp, lp);
            uint vk = key.vkCode;
            if(down) Pressed.Add(vk); else if(up) Pressed.Remove(vk); UpdateModifiers();
            if (Held&&up&&(vk==HeldBinding.Key||HeldBinding.RequiredReleased(Ctrl,Alt,Shift,Win))) { Held=false; Program.Hotkey("up",Mode,IntPtr.Zero); }
            if(up&&Consumed.Remove(vk)) return (IntPtr)1;
            if(down&&Consumed.Contains(vk)) return (IntPtr)1;
            if(vk==0x1B&&down&&(Program.SessionActive||Program.InteractionActive||Held)) { Consumed.Add(vk); Held=false; Program.Hotkey("cancel",Mode,IntPtr.Zero); return (IntPtr)1; }
            if(down) foreach(Binding binding in Bindings) if(binding.Matches(vk,Ctrl,Alt,Shift,Win)) {
                Consumed.Add(vk);
                if(binding.Action=="down") { Held=true; HeldBinding=binding; Mode=binding.Mode; }
                Program.Hotkey(binding.Action,binding.Mode,GetForegroundWindow()); return (IntPtr)1;
            }
        }
        return CallNextHookEx(Hook, code, wp, lp);
    }
    public void Dispose() { if (ThreadId != 0) PostThreadMessage(ThreadId, 0x12, IntPtr.Zero, IntPtr.Zero); if (Worker != null) Worker.Join(1000); Ready.Dispose(); }
    delegate IntPtr HookProc(int code, IntPtr wp, IntPtr lp);
    [StructLayout(LayoutKind.Sequential)] struct KBDLLHOOKSTRUCT { public uint vkCode, scanCode, flags, time; public UIntPtr extraInfo; }
    [StructLayout(LayoutKind.Sequential)] struct MSG { public IntPtr hwnd; public uint message; public UIntPtr wParam; public IntPtr lParam; public uint time; public int x,y; public uint privateValue; }
    [DllImport("user32.dll")] static extern IntPtr SetWindowsHookEx(int idHook, HookProc proc, IntPtr module, uint threadId);
    [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr hook);
    [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr hook,int code,IntPtr wp,IntPtr lp);
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll")] static extern int GetMessage(out MSG msg,IntPtr hwnd,uint min,uint max);
    [DllImport("user32.dll")] static extern bool TranslateMessage(ref MSG msg);
    [DllImport("user32.dll")] static extern IntPtr DispatchMessage(ref MSG msg);
    [DllImport("user32.dll")] static extern bool PostThreadMessage(uint threadId,uint msg,IntPtr wp,IntPtr lp);
    [DllImport("user32.dll")] internal static extern IntPtr GetForegroundWindow();
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern IntPtr GetModuleHandle(string name);
}

internal sealed class DeviceMonitor : NativeWindow, IDisposable {
    long LastNotice;
    internal DeviceMonitor() { CreateHandle(new CreateParams { Caption="Willfull device notifications",Style=0,Parent=IntPtr.Zero,Width=0,Height=0 }); }
    protected override void WndProc(ref Message message) {
        if(message.Msg==0x219) {
            long now=DateTime.UtcNow.Ticks;
            if(now-LastNotice>TimeSpan.TicksPerMillisecond*250) { LastNotice=now; Program.Emit(Program.Obj("event","devices-changed")); }
        }
        base.WndProc(ref message);
    }
    public void Dispose() { DestroyHandle(); }
}

internal static class FocusSnapshot {
    internal static Dictionary<string, object> Capture(IntPtr expected) {
        IntPtr hwnd = KeyboardHook.GetForegroundWindow(); uint pid;
        GetWindowThreadProcessId(hwnd, out pid);
        var title = new StringBuilder(512); GetWindowText(hwnd,title,title.Capacity);
        var result = Program.Obj("hwnd", hwnd.ToInt64().ToString(), "pid", pid, "windowTitle", title.ToString(), "isPassword", false, "selectionAvailable", false, "selectionText", "", "caretAvailable", false);
        if (expected != IntPtr.Zero && expected != hwnd) { result["stale"] = true; return result; }
        try {
            AutomationElement field = AutomationElement.FocusedElement;
            if (field == null || field.Current.ProcessId != (int)pid) return result;
            result["runtimeId"] = String.Join(".", field.GetRuntimeId());
            result["focusedHwnd"] = field.Current.NativeWindowHandle.ToString();
            result["automationId"] = field.Current.AutomationId;
            result["controlType"] = field.Current.ControlType.ProgrammaticName;
            result["isPassword"] = field.Current.IsPassword;
            result["isEnabled"] = field.Current.IsEnabled;
            if (field.Current.IsPassword) return result;
            object pattern;
            if (field.TryGetCurrentPattern(TextPattern.Pattern, out pattern)) {
                var text = (TextPattern)pattern;
                TextPatternRange[] ranges = text.GetSelection();
                if (ranges.Length == 1) {
                    var range = ranges[0];
                    result["selectionAvailable"] = true; result["selectionText"] = range.GetText(8192);
                    var before = text.DocumentRange.Clone(); before.MoveEndpointByRange(TextPatternRangeEndpoint.End,range,TextPatternRangeEndpoint.Start);
                    string prefix = before.GetText(32768);
                    result["selectionStart"] = prefix.Length; result["caretAvailable"] = prefix.Length < 32768;
                }
                string document = text.DocumentRange.GetText(32768);
                result["textHash"] = Hash(document); result["textLength"] = document.Length;
            } else if (field.TryGetCurrentPattern(ValuePattern.Pattern, out pattern)) {
                var value = (ValuePattern)pattern;
                result["isReadOnly"] = value.Current.IsReadOnly;
                string document = value.Current.Value ?? "";
                result["textHash"] = Hash(document.Substring(0,Math.Min(document.Length,32768))); result["textLength"] = document.Length;
                IntPtr edit = new IntPtr(field.Current.NativeWindowHandle);
                var className = new StringBuilder(128); GetClassName(edit,className,className.Capacity);
                if (edit != IntPtr.Zero && (className.ToString().Equals("Edit",StringComparison.OrdinalIgnoreCase) || className.ToString().StartsWith("RichEdit",StringComparison.OrdinalIgnoreCase))) {
                    IntPtr start=Marshal.AllocHGlobal(4), end=Marshal.AllocHGlobal(4), messageResult;
                    try {
                        Marshal.WriteInt32(start,0); Marshal.WriteInt32(end,0);
                        if (SendMessageTimeout(edit,0xB0,start,end,2,150,out messageResult)!=IntPtr.Zero) {
                            int first=Marshal.ReadInt32(start), last=Marshal.ReadInt32(end);
                            if (first>=0 && last>=first && last<=document.Length) {
                                result["selectionStart"]=first; result["selectionEnd"]=last; result["selectionText"]=document.Substring(first,Math.Min(last-first,8192));
                                result["selectionAvailable"]=true; result["caretAvailable"]=true;
                            }
                        }
                    } finally { Marshal.FreeHGlobal(start); Marshal.FreeHGlobal(end); }
                }
            }
        } catch (Exception ex) { result["contextUnavailable"] = ex.GetType().Name; }
        return result;
    }
    static string Hash(string value) { using (var sha = SHA256.Create()) return Convert.ToBase64String(sha.ComputeHash(Encoding.UTF8.GetBytes(value))); }
    internal static void Validate(Dictionary<string, object> target) {
        var current = Capture(IntPtr.Zero);
        if (!target.ContainsKey("runtimeId") || !current.ContainsKey("runtimeId")) throw new InvalidOperationException("The focused field cannot be identified reliably. Copy the result manually.");
        foreach (string key in new [] { "hwnd", "pid", "runtimeId", "focusedHwnd", "textHash", "selectionStart", "selectionEnd", "selectionText" }) {
            object oldValue, newValue;
            if (target.TryGetValue(key, out oldValue) && (!current.TryGetValue(key,out newValue) || Convert.ToString(oldValue) != Convert.ToString(newValue))) throw new InvalidOperationException("Target changed (" + key + "). Result retained for manual paste.");
        }
        if ((target.ContainsKey("stale") && Convert.ToBoolean(target["stale"])) || Convert.ToBoolean(current["isPassword"])) throw new InvalidOperationException("Protected or stale target; use manual copy.");
        object readOnly; if (current.TryGetValue("isReadOnly",out readOnly) && Convert.ToBoolean(readOnly)) throw new InvalidOperationException("The target is read-only.");
        uint pid; GetWindowThreadProcessId(KeyboardHook.GetForegroundWindow(),out pid);
        if (IsElevated(pid)) throw new InvalidOperationException("Elevated target: Windows blocks standard-user insertion. Copy the result manually.");
    }
    static bool IsElevated(uint pid) {
        IntPtr process = OpenProcess(0x1000,false,pid), token;
        if (process == IntPtr.Zero) return false;
        try { if (!OpenProcessToken(process,8,out token)) return false; try { int elevated, length; return GetTokenInformation(token,20,out elevated,4,out length) && elevated != 0; } finally { CloseHandle(token); } }
        finally { CloseHandle(process); }
    }
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd,out uint pid);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr hwnd,StringBuilder text,int max);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd,StringBuilder text,int max);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern IntPtr SendMessageTimeout(IntPtr hwnd,uint message,IntPtr wp,IntPtr lp,uint flags,uint timeout,out IntPtr result);
    [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access,bool inherit,uint pid);
    [DllImport("advapi32.dll")] static extern bool OpenProcessToken(IntPtr process,uint access,out IntPtr token);
    [DllImport("advapi32.dll")] static extern bool GetTokenInformation(IntPtr token,int type,out int value,int size,out int length);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
}

internal static class ClipboardTransaction {
    internal static object Paste(string text,Dictionary<string, object> target) {
        int waited=0;
        while (ModifiersDown() && waited < 2000) { Thread.Sleep(10); waited += 10; }
        if (ModifiersDown()) throw new InvalidOperationException("Release activation modifiers before pasting.");
        FocusSnapshot.Validate(target);
        var backup = new DataObject(); int saved=0, skipped=0;
        IDataObject original = Clipboard.GetDataObject();
        if (original != null) foreach (string format in original.GetFormats(false)) {
            try {
                object value = original.GetData(format,false);
                if (value is string || value is byte[] || value is string[]) { backup.SetData(format,false,value); saved++; }
                else if (value is MemoryStream) { backup.SetData(format,false,new MemoryStream(((MemoryStream)value).ToArray())); saved++; }
                else if (value is Image) { backup.SetData(format,false,((Image)value).Clone()); saved++; }
                else skipped++;
            } catch { skipped++; }
        }
        Clipboard.SetText(text,TextDataFormat.UnicodeText);
        uint sequence = GetClipboardSequenceNumber();
        bool sent = false, restored = false;
        try {
            FocusSnapshot.Validate(target);
            INPUT[] keys = new INPUT[] { Key(0x11,false), Key(0x56,false), Key(0x56,true), Key(0x11,true) };
            sent = SendInput((uint)keys.Length,keys,Marshal.SizeOf(typeof(INPUT))) == keys.Length;
            if (!sent) throw new InvalidOperationException("Windows rejected paste input; copy the result manually.");
            // There is no universal paste-consumed notification. Retain our payload for a conservative interval.
            Thread.Sleep(450);
        } finally {
            if (GetClipboardSequenceNumber() == sequence) {
                try { if (saved > 0) Clipboard.SetDataObject(backup,true,3,20); else if (skipped == 0) Clipboard.Clear(); restored = saved > 0 || skipped == 0; } catch { }
            }
        }
        return Program.Obj("inserted",sent,"clipboardRestored",restored,"preservedFormats",saved,"unsupportedFormats",skipped,"verifiedInTarget",false);
    }
    static bool ModifiersDown() { return (GetAsyncKeyState(0x11)&0x8000)!=0 || (GetAsyncKeyState(0x12)&0x8000)!=0 || (GetAsyncKeyState(0x10)&0x8000)!=0 || (GetAsyncKeyState(0x5B)&0x8000)!=0 || (GetAsyncKeyState(0x5C)&0x8000)!=0; }
    static INPUT Key(ushort code,bool up) { return new INPUT { type=1, union=new InputUnion { keyboard=new KEYBDINPUT { vk=code,flags=up?2u:0u } } }; }
    [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public InputUnion union; }
    [StructLayout(LayoutKind.Explicit)] struct InputUnion { [FieldOffset(0)] public MOUSEINPUT mouse; [FieldOffset(0)] public KEYBDINPUT keyboard; [FieldOffset(0)] public HARDWAREINPUT hardware; }
    [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort vk,scan; public uint flags,time; public UIntPtr extra; }
    [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int x,y; public uint data,flags,time; public UIntPtr extra; }
    [StructLayout(LayoutKind.Sequential)] struct HARDWAREINPUT { public uint message; public ushort low,high; }
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll")] static extern uint SendInput(uint count,INPUT[] inputs,int size);
    [DllImport("user32.dll")] static extern uint GetClipboardSequenceNumber();
}

internal sealed class AudioCapture : IDisposable {
    const uint CALLBACK_EVENT=0x50000; const uint WHDR_DONE=1;
    IntPtr Handle; readonly string Session; readonly int Device; readonly AutoResetEvent DataEvent=new AutoResetEvent(false); readonly ManualResetEvent StopEvent=new ManualResetEvent(false);
    readonly List<Buffer> Buffers=new List<Buffer>(); Thread Worker; volatile bool Stopping; bool Discard;
    sealed class Buffer { internal IntPtr Data,Header; }
    internal AudioCapture(string session,int device) { Session=session; Device=device; }
    internal static object Devices() {
        var result=new List<object>(); uint count=waveInGetNumDevs();
        if (count > 0) result.Add(Program.Obj("id",-1,"name","System default microphone","channels",1,"isDefault",true));
        for (uint i=0;i<count;i++) { WAVEINCAPS caps; if (waveInGetDevCaps(new UIntPtr(i),out caps,(uint)Marshal.SizeOf(typeof(WAVEINCAPS)))==0) result.Add(Program.Obj("id",i,"name",caps.name,"channels",caps.channels,"isDefault",false)); }
        return result;
    }
    internal void Start() {
        var format=new WAVEFORMATEX { tag=1,channels=1,sampleRate=16000,bytesPerSecond=32000,blockAlign=2,bitsPerSample=16,extra=0 };
        Check(waveInOpen(out Handle,Device<0?UInt32.MaxValue:(uint)Device,ref format,DataEvent.SafeWaitHandle.DangerousGetHandle(),IntPtr.Zero,CALLBACK_EVENT),"Opening microphone (16 kHz mono PCM)");
        for (int i=0;i<4;i++) {
            var buffer=new Buffer { Data=Marshal.AllocHGlobal(3200),Header=Marshal.AllocHGlobal(Marshal.SizeOf(typeof(WAVEHDR))) };
            var header=new WAVEHDR { data=buffer.Data,length=3200 };
            Marshal.StructureToPtr(header,buffer.Header,false); Buffers.Add(buffer);
            Check(waveInPrepareHeader(Handle,buffer.Header,(uint)Marshal.SizeOf(typeof(WAVEHDR))),"Preparing microphone buffer");
            Check(waveInAddBuffer(Handle,buffer.Header,(uint)Marshal.SizeOf(typeof(WAVEHDR))),"Queueing microphone buffer");
        }
        Worker=new Thread(Run); Worker.IsBackground=true; Worker.Name="Willfull microphone"; Worker.Start();
        Check(waveInStart(Handle),"Starting microphone");
    }
    void Run() {
        WaitHandle[] signals=new WaitHandle[] { DataEvent,StopEvent };
        var lastData=Stopwatch.StartNew(); var lastCheck=Stopwatch.StartNew();
        while (true) {
            WaitHandle.WaitAny(signals,250);
            foreach (Buffer buffer in Buffers) {
                var header=(WAVEHDR)Marshal.PtrToStructure(buffer.Header,typeof(WAVEHDR));
                if ((header.flags&WHDR_DONE)==0) continue;
                if (header.recorded>0 && !Discard) {
                    lastData.Restart();
                    byte[] bytes=new byte[header.recorded]; Marshal.Copy(buffer.Data,bytes,0,bytes.Length);
                    double sum=0; for (int p=0;p+1<bytes.Length;p+=2) { short s=(short)(bytes[p]|(bytes[p+1]<<8)); double f=s/32768.0; sum+=f*f; }
                    double level=Math.Min(1,Math.Sqrt(sum/Math.Max(1,bytes.Length/2))*3);
                    if (!Program.Emit(Program.Obj("event","audio","sessionId",Session,"pcm",Convert.ToBase64String(bytes),"level",Math.Round(level,4),"sampleRate",16000))) {
                        CaptureFault("Audio pipe backpressure; recording cannot continue safely.");
                    }
                }
                if (!Stopping) {
                    header.recorded=0; Marshal.StructureToPtr(header,buffer.Header,false);
                    uint added=waveInAddBuffer(Handle,buffer.Header,(uint)Marshal.SizeOf(typeof(WAVEHDR)));
                    if(added!=0) CaptureFault("The microphone stopped accepting audio buffers. Reconnect it and select a microphone again.");
                }
            }
            if(!Stopping&&lastCheck.ElapsedMilliseconds>=500) {
                var position=new MMTIME { type=4 }; uint status=waveInGetPosition(Handle,ref position,(uint)Marshal.SizeOf(typeof(MMTIME))); lastCheck.Restart();
                if(status!=0) CaptureFault("The microphone became unavailable. Reconnect it and select a microphone again.");
                else if(lastData.ElapsedMilliseconds>5000) CaptureFault("No microphone data arrived for five seconds. Check the input device and try again.");
            }
            if (Stopping) break;
        }
    }
    void CaptureFault(string message) {
        if(Stopping) return; Discard=true; Stopping=true;
        waveInStop(Handle); waveInReset(Handle);
        Program.Emit(Program.Obj("event","capture-error","sessionId",Session,"error",message));
    }
    internal void Stop(bool discard) {
        if (Handle==IntPtr.Zero) return;
        Discard=discard; Stopping=true; waveInStop(Handle); waveInReset(Handle); StopEvent.Set();
        if (Worker!=null && !Worker.Join(2000)) throw new InvalidOperationException("Microphone worker did not stop promptly.");
    }
    public void Dispose() {
        if (Handle!=IntPtr.Zero) {
            Stop(true);
            foreach (Buffer buffer in Buffers) { waveInUnprepareHeader(Handle,buffer.Header,(uint)Marshal.SizeOf(typeof(WAVEHDR))); Marshal.FreeHGlobal(buffer.Header); Marshal.FreeHGlobal(buffer.Data); }
            waveInClose(Handle); Handle=IntPtr.Zero; Buffers.Clear();
        }
        DataEvent.Dispose(); StopEvent.Dispose();
    }
    static void Check(uint code,string operation) { if (code!=0) { var text=new StringBuilder(256); waveInGetErrorText(code,text,text.Capacity); throw new InvalidOperationException(operation+": "+text+" ("+code+")"); } }
    [StructLayout(LayoutKind.Sequential,Pack=2)] struct WAVEFORMATEX { public ushort tag,channels; public uint sampleRate,bytesPerSecond; public ushort blockAlign,bitsPerSample,extra; }
    [StructLayout(LayoutKind.Sequential)] struct WAVEHDR { public IntPtr data; public uint length,recorded; public UIntPtr user; public uint flags,loops; public IntPtr next; public UIntPtr reserved; }
    [StructLayout(LayoutKind.Sequential)] struct MMTIME { public uint type,low,high; }
    [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct WAVEINCAPS { public ushort manufacturer,product; public uint version; [MarshalAs(UnmanagedType.ByValTStr,SizeConst=32)] public string name; public uint formats; public ushort channels,reserved; }
    [DllImport("winmm.dll")] static extern uint waveInGetNumDevs();
    [DllImport("winmm.dll",CharSet=CharSet.Unicode)] static extern uint waveInGetDevCaps(UIntPtr id,out WAVEINCAPS caps,uint size);
    [DllImport("winmm.dll")] static extern uint waveInOpen(out IntPtr handle,uint device,ref WAVEFORMATEX format,IntPtr callback,IntPtr instance,uint flags);
    [DllImport("winmm.dll")] static extern uint waveInPrepareHeader(IntPtr handle,IntPtr header,uint size);
    [DllImport("winmm.dll")] static extern uint waveInUnprepareHeader(IntPtr handle,IntPtr header,uint size);
    [DllImport("winmm.dll")] static extern uint waveInAddBuffer(IntPtr handle,IntPtr header,uint size);
    [DllImport("winmm.dll")] static extern uint waveInStart(IntPtr handle);
    [DllImport("winmm.dll")] static extern uint waveInGetPosition(IntPtr handle,ref MMTIME time,uint size);
    [DllImport("winmm.dll")] static extern uint waveInStop(IntPtr handle);
    [DllImport("winmm.dll")] static extern uint waveInReset(IntPtr handle);
    [DllImport("winmm.dll")] static extern uint waveInClose(IntPtr handle);
    [DllImport("winmm.dll",CharSet=CharSet.Unicode)] static extern uint waveInGetErrorText(uint error,StringBuilder text,int size);
}
}
