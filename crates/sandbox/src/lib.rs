use anyhow::{Context, Result};
use std::time::Duration;

pub mod env;
pub mod owner_only;

pub struct JobGuard {
    inner: Inner,
}

enum Inner {
    #[cfg(windows)]
    Windows {
        handle: windows::Win32::Foundation::HANDLE,
    },
    TimeoutOnly,
}

pub fn wrap_pid(pid: u32) -> Result<JobGuard> {
    if pid == 0 {
        return Ok(JobGuard {
            inner: Inner::TimeoutOnly,
        });
    }
    #[cfg(windows)]
    {
        match windows_job(pid) {
            Ok(g) => Ok(g),
            Err(err) => {
                tracing::warn!("job object unavailable: {err}");
                Ok(JobGuard {
                    inner: Inner::TimeoutOnly,
                })
            }
        }
    }
    #[cfg(not(windows))]
    {
        let _ = pid;
        Ok(JobGuard {
            inner: Inner::TimeoutOnly,
        })
    }
}

pub fn default_timeout() -> Duration {
    Duration::from_secs(120)
}

#[cfg(windows)]
fn windows_job(pid: u32) -> Result<JobGuard> {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    use windows::Win32::System::Threading::{OpenProcess, PROCESS_ALL_ACCESS};

    unsafe {
        let job = CreateJobObjectW(None, None).context("CreateJobObjectW")?;
        let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &info as *const _ as *const _,
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        )
        .context("SetInformationJobObject")?;

        let proc = OpenProcess(PROCESS_ALL_ACCESS, false, pid).context("OpenProcess")?;
        let assigned = AssignProcessToJobObject(job, proc);
        let _ = CloseHandle(proc);
        assigned.context("AssignProcessToJobObject")?;
        Ok(JobGuard {
            inner: Inner::Windows { handle: job },
        })
    }
}

unsafe impl Send for JobGuard {}

impl Drop for JobGuard {
    fn drop(&mut self) {
        match self.inner {
            #[cfg(windows)]
            Inner::Windows { handle } => unsafe {
                let _ = windows::Win32::Foundation::CloseHandle(handle);
            },
            Inner::TimeoutOnly => {}
        }
    }
}
