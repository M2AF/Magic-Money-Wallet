//! magic-guard-core — JNI bindings around Brave's `adblock` crate for the
//! Android dApp browser (MAGIC_GUARD_IMPLEMENTATION_PLAN.md Batch E).
//!
//! Narrow surface by design (plan section 11): create an engine from filter
//! list texts, check one request, destroy the engine. No browsing history,
//! wallet data, or JavaScript ever crosses this boundary — only URL/request
//! metadata strings.
//!
//! Every entry point is panic-proof (catch_unwind) and fails OPEN: any error
//! returns "not blocked" / a null handle rather than crashing the app process.

use std::panic::{catch_unwind, AssertUnwindSafe};

use adblock::lists::{FilterSet, ParseOptions, RuleTypes};
use adblock::request::Request;
use adblock::Engine;
use jni::objects::{JClass, JObjectArray, JString};
use jni::sys::{jboolean, jlong, jsize, JNI_FALSE, JNI_TRUE};
use jni::JNIEnv;

fn jstring_to_string(env: &mut JNIEnv, s: &JString) -> Option<String> {
    if s.is_null() {
        return None;
    }
    env.get_string(s).ok().map(|v| v.into())
}

/// Build an Engine from an array of filter-list texts (network rules only) and
/// return an opaque heap handle, or 0 on any failure.
#[no_mangle]
pub extern "system" fn Java_info_chainlens_magicmoney_MagicGuardNative_nativeCreate(
    mut env: JNIEnv,
    _class: JClass,
    lists: JObjectArray,
) -> jlong {
    let result = catch_unwind(AssertUnwindSafe(|| {
        let len: jsize = env.get_array_length(&lists).ok()?;
        let mut filter_set = FilterSet::new(false);
        for i in 0..len {
            let element = env.get_object_array_element(&lists, i).ok()?;
            let jstr = JString::from(element);
            if let Some(text) = jstring_to_string(&mut env, &jstr) {
                if !text.trim().is_empty() {
                    filter_set.add_filter_list(
                        text,
                        ParseOptions {
                            rule_types: RuleTypes::NetworkOnly,
                            ..ParseOptions::default()
                        },
                    );
                }
            }
        }
        let engine = Engine::new_with_filter_set(filter_set);
        Some(Box::into_raw(Box::new(engine)) as jlong)
    }));
    match result {
        Ok(Some(handle)) => handle,
        _ => 0,
    }
}

/// Check one request. Returns JNI_TRUE only for a definite block decision;
/// every error path (null/invalid handle, bad strings, malformed URL, panic)
/// returns JNI_FALSE — fail open, never break browsing.
#[no_mangle]
pub extern "system" fn Java_info_chainlens_magicmoney_MagicGuardNative_nativeCheck(
    mut env: JNIEnv,
    _class: JClass,
    handle: jlong,
    url: JString,
    source_url: JString,
    request_type: JString,
) -> jboolean {
    if handle == 0 {
        return JNI_FALSE;
    }
    let result = catch_unwind(AssertUnwindSafe(|| {
        // SAFETY: handle is only ever a Box::into_raw from nativeCreate that the
        // Java side (MagicGuardNative) guarantees is not destroyed while checks
        // are in flight. Engine is Sync (single-thread feature disabled), so
        // concurrent &self checks from multiple WebView IO threads are sound.
        let engine: &Engine = unsafe { &*(handle as *const Engine) };
        let url = jstring_to_string(&mut env, &url)?;
        let source_url = jstring_to_string(&mut env, &source_url).unwrap_or_default();
        let request_type = jstring_to_string(&mut env, &request_type)?;
        let request = Request::new(&url, &source_url, &request_type, "").ok()?;
        Some(engine.check_network_request(&request).should_block())
    }));
    match result {
        Ok(Some(true)) => JNI_TRUE,
        _ => JNI_FALSE,
    }
}

/// Free the engine. The Java wrapper must ensure no checks are in flight.
#[no_mangle]
pub extern "system" fn Java_info_chainlens_magicmoney_MagicGuardNative_nativeDestroy(
    _env: JNIEnv,
    _class: JClass,
    handle: jlong,
) {
    if handle != 0 {
        let _ = catch_unwind(AssertUnwindSafe(|| {
            // SAFETY: handle came from Box::into_raw in nativeCreate; called at
            // most once per handle by the Java wrapper.
            drop(unsafe { Box::from_raw(handle as *mut Engine) });
        }));
    }
}
